use anchor_lang::prelude::*;

declare_id!("9fWTsjzHwtY3rvai9Mdsz1gidXq2H4oGBunjnwVcSu9U");

pub const REGISTRY_SEED: &[u8] = b"registry";
pub const DAY_SEED: &[u8] = b"day";

/// Flarewatch: a write-once ledger for satellite gas-flare observations.
///
/// Every night NASA's VIIRS sensors see the Niger Delta's gas flares. The
/// off-chain pipeline turns one UTC day of detections into a canonical JSON
/// file and records its SHA-256 here. A day can be recorded exactly once:
/// there is no update or close instruction, so a published day can never be
/// quietly revised. Anyone can hash the public file and compare.
#[program]
pub mod flarewatch {
    use super::*;

    /// Create the registry. `method_digest` is the SHA-256 of the detection
    /// method document, fixed for the life of the registry.
    pub fn initialize(ctx: Context<Initialize>, method_digest: [u8; 32]) -> Result<()> {
        require!(method_digest != [0u8; 32], FlareError::EmptyDigest);
        let registry = &mut ctx.accounts.registry;
        registry.authority = ctx.accounts.authority.key();
        registry.method_digest = method_digest;
        registry.days_recorded = 0;
        registry.latest_day = 0;
        registry.bump = ctx.bumps.registry;
        Ok(())
    }

    /// Record one UTC day (`day` as YYYYMMDD). Fails if the day already exists.
    pub fn record_day(
        ctx: Context<RecordDay>,
        day: u32,
        digest: [u8; 32],
        flare_sites: u16,
        detections: u32,
        total_frp_kw: u64,
    ) -> Result<()> {
        require!(valid_day(day), FlareError::InvalidDay);
        require!(digest != [0u8; 32], FlareError::EmptyDigest);
        require!(
            detections >= flare_sites as u32,
            FlareError::InconsistentCounts
        );

        let now = Clock::get()?.unix_timestamp;
        require!(day_start_unix(day) < now, FlareError::FutureDay);

        let record = &mut ctx.accounts.day_record;
        record.day = day;
        record.digest = digest;
        record.flare_sites = flare_sites;
        record.detections = detections;
        record.total_frp_kw = total_frp_kw;
        record.recorded_at = now;
        record.recorder = ctx.accounts.authority.key();
        record.bump = ctx.bumps.day_record;

        let registry = &mut ctx.accounts.registry;
        registry.days_recorded = registry
            .days_recorded
            .checked_add(1)
            .ok_or(FlareError::Overflow)?;
        if day > registry.latest_day {
            registry.latest_day = day;
        }

        emit!(DayRecorded {
            day,
            digest,
            flare_sites,
            detections,
            total_frp_kw,
        });
        Ok(())
    }
}

fn valid_day(day: u32) -> bool {
    let (y, m, d) = (day / 10_000, (day / 100) % 100, day % 100);
    (2012..=2100).contains(&y) && (1..=12).contains(&m) && d >= 1 && d <= days_in_month(y, m)
}

fn days_in_month(y: u32, m: u32) -> u32 {
    match m {
        2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Unix time of 00:00 UTC on `day` (days-from-civil, Howard Hinnant).
fn day_start_unix(day: u32) -> i64 {
    let (y, m, d) = (
        (day / 10_000) as i64,
        ((day / 100) % 100) as i64,
        (day % 100) as i64,
    );
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146_097 + doe - 719_468) * 86_400
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Registry::INIT_SPACE,
        seeds = [REGISTRY_SEED],
        bump
    )]
    pub registry: Account<'info, Registry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(day: u32)]
pub struct RecordDay<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [REGISTRY_SEED],
        bump = registry.bump,
        has_one = authority @ FlareError::Unauthorized
    )]
    pub registry: Account<'info, Registry>,
    #[account(
        init,
        payer = authority,
        space = 8 + DayRecord::INIT_SPACE,
        seeds = [DAY_SEED, &day.to_le_bytes()],
        bump
    )]
    pub day_record: Account<'info, DayRecord>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Registry {
    pub authority: Pubkey,
    pub method_digest: [u8; 32],
    pub days_recorded: u32,
    pub latest_day: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct DayRecord {
    pub day: u32,
    pub digest: [u8; 32],
    pub flare_sites: u16,
    pub detections: u32,
    pub total_frp_kw: u64,
    pub recorded_at: i64,
    pub recorder: Pubkey,
    pub bump: u8,
}

#[event]
pub struct DayRecorded {
    pub day: u32,
    pub digest: [u8; 32],
    pub flare_sites: u16,
    pub detections: u32,
    pub total_frp_kw: u64,
}

#[error_code]
pub enum FlareError {
    #[msg("Only the registry authority can record days")]
    Unauthorized,
    #[msg("Day must be a real calendar date as YYYYMMDD")]
    InvalidDay,
    #[msg("Day has not started yet")]
    FutureDay,
    #[msg("Digest must not be all zeros")]
    EmptyDigest,
    #[msg("Flare sites cannot exceed detections")]
    InconsistentCounts,
    #[msg("Counter overflow")]
    Overflow,
}

#[cfg(test)]
mod unit {
    use super::*;

    #[test]
    fn day_validation() {
        assert!(valid_day(20261021));
        assert!(valid_day(20240229));
        assert!(!valid_day(20250229));
        assert!(!valid_day(20261131));
        assert!(!valid_day(20261300));
        assert!(!valid_day(1021));
    }

    #[test]
    fn day_start() {
        assert_eq!(day_start_unix(19700101), 0);
        assert_eq!(day_start_unix(20261021), 1_792_540_800);
    }
}
