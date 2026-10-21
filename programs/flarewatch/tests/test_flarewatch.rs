use {
    anchor_lang::{
        solana_program::{clock::Clock, instruction::Instruction},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_pubkey::Pubkey,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

// 2026-10-21 12:00 UTC.
const NOW: i64 = 1_792_584_000;
const METHOD: [u8; 32] = [7u8; 32];

fn system_program() -> Pubkey {
    Pubkey::default()
}

fn registry_pda(program_id: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[flarewatch::REGISTRY_SEED], program_id).0
}

fn day_pda(day: u32, program_id: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[flarewatch::DAY_SEED, &day.to_le_bytes()], program_id).0
}

fn send(
    svm: &mut LiteSVM,
    program_id: Pubkey,
    data: Vec<u8>,
    metas: Vec<anchor_lang::solana_program::instruction::AccountMeta>,
    payer: &Keypair,
) -> Result<(), String> {
    let ix = Instruction {
        program_id,
        accounts: metas,
        data,
    };
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer])
        .map_err(|e| e.to_string())?;
    let res = svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{:?} {:?}", e.err, e.meta.logs));
    svm.expire_blockhash();
    res
}

fn setup() -> (LiteSVM, Pubkey, Keypair) {
    let program_id = flarewatch::id();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/flarewatch.so"
    ));
    svm.add_program(program_id, bytes).unwrap();
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = NOW;
    svm.set_sysvar(&clock);

    let authority = Keypair::new();
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();
    send(
        &mut svm,
        program_id,
        flarewatch::instruction::Initialize {
            method_digest: METHOD,
        }
        .data(),
        flarewatch::accounts::Initialize {
            authority: authority.pubkey(),
            registry: registry_pda(&program_id),
            system_program: system_program(),
        }
        .to_account_metas(None),
        &authority,
    )
    .expect("initialize");
    (svm, program_id, authority)
}

fn record(
    svm: &mut LiteSVM,
    program_id: Pubkey,
    signer: &Keypair,
    day: u32,
    digest: [u8; 32],
    sites: u16,
    detections: u32,
) -> Result<(), String> {
    send(
        svm,
        program_id,
        flarewatch::instruction::RecordDay {
            day,
            digest,
            flare_sites: sites,
            detections,
            total_frp_kw: 123_456,
        }
        .data(),
        flarewatch::accounts::RecordDay {
            authority: signer.pubkey(),
            registry: registry_pda(&program_id),
            day_record: day_pda(day, &program_id),
            system_program: system_program(),
        }
        .to_account_metas(None),
        signer,
    )
}

fn load<T: AccountDeserialize>(svm: &LiteSVM, key: &Pubkey) -> T {
    let acc = svm.get_account(key).expect("account exists");
    T::try_deserialize(&mut acc.data.as_slice()).unwrap()
}

#[test]
fn records_a_day_and_updates_registry() {
    let (mut svm, pid, auth) = setup();
    record(&mut svm, pid, &auth, 20261018, [1u8; 32], 42, 180).expect("record");

    let rec: flarewatch::DayRecord = load(&svm, &day_pda(20261018, &pid));
    assert_eq!(rec.day, 20261018);
    assert_eq!(rec.digest, [1u8; 32]);
    assert_eq!(rec.flare_sites, 42);
    assert_eq!(rec.detections, 180);
    assert_eq!(rec.total_frp_kw, 123_456);
    assert_eq!(rec.recorded_at, NOW);
    assert_eq!(rec.recorder, auth.pubkey());

    let reg: flarewatch::Registry = load(&svm, &registry_pda(&pid));
    assert_eq!(reg.method_digest, METHOD);
    assert_eq!(reg.days_recorded, 1);
    assert_eq!(reg.latest_day, 20261018);

    // An older day does not move latest_day back.
    record(&mut svm, pid, &auth, 20261015, [2u8; 32], 40, 170).expect("older day");
    let reg: flarewatch::Registry = load(&svm, &registry_pda(&pid));
    assert_eq!(reg.days_recorded, 2);
    assert_eq!(reg.latest_day, 20261018);
}

#[test]
fn a_day_cannot_be_rewritten() {
    let (mut svm, pid, auth) = setup();
    record(&mut svm, pid, &auth, 20261018, [1u8; 32], 42, 180).expect("first write");
    let err = record(&mut svm, pid, &auth, 20261018, [9u8; 32], 1, 1);
    assert!(err.is_err(), "second write to the same day must fail");
    let rec: flarewatch::DayRecord = load(&svm, &day_pda(20261018, &pid));
    assert_eq!(rec.digest, [1u8; 32], "original digest survives");
}

#[test]
fn only_the_authority_can_record() {
    let (mut svm, pid, _auth) = setup();
    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let err = record(&mut svm, pid, &stranger, 20261018, [1u8; 32], 1, 1).unwrap_err();
    assert!(err.contains("Unauthorized") || err.contains("Custom(6000)"), "{err}");
}

#[test]
fn rejects_bad_input() {
    let (mut svm, pid, auth) = setup();
    // Not a calendar date.
    assert!(record(&mut svm, pid, &auth, 20261131, [1u8; 32], 1, 1).is_err());
    // Future day (clock is 2026-10-21).
    assert!(record(&mut svm, pid, &auth, 20261022, [1u8; 32], 1, 1).is_err());
    // Zero digest.
    assert!(record(&mut svm, pid, &auth, 20261018, [0u8; 32], 1, 1).is_err());
    // More sites than detections.
    assert!(record(&mut svm, pid, &auth, 20261018, [1u8; 32], 5, 4).is_err());
    // Today is allowed (the day has started).
    record(&mut svm, pid, &auth, 20261021, [1u8; 32], 1, 1).expect("today");
}

#[test]
fn registry_cannot_be_initialized_twice() {
    let (mut svm, pid, auth) = setup();
    let err = send(
        &mut svm,
        pid,
        flarewatch::instruction::Initialize {
            method_digest: [3u8; 32],
        }
        .data(),
        flarewatch::accounts::Initialize {
            authority: auth.pubkey(),
            registry: registry_pda(&pid),
            system_program: system_program(),
        }
        .to_account_metas(None),
        &auth,
    );
    assert!(err.is_err());
    let reg: flarewatch::Registry = load(&svm, &registry_pda(&pid));
    assert_eq!(reg.method_digest, METHOD);
}
