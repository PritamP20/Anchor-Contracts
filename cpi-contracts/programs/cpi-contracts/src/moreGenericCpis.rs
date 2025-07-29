use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};

pub fn sol_transfer(ctx: Context<SolTransfer>, amount: u64) -> Result<()> {
    let from_pubkey = ctx.accounts.sender.key();
    let to_pubkey = ctx.accounts.recipient.key();
    let program_id = ctx.accounts.system_program.key(); // should be system_program's pubkey

    let account_metas = vec![
        AccountMeta::new(from_pubkey, true),
        AccountMeta::new(to_pubkey, false), // recipient doesn't need to sign
    ];

    // dummy 4-byte discriminator if you're simulating (not actual Anchor)
    let instruction_discriminator: u32 = 2;

    // create instruction data
    let mut instruction_data = Vec::with_capacity(4 + 8); // u32 + u64 = 12 bytes
    instruction_data.extend_from_slice(&instruction_discriminator.to_le_bytes());
    instruction_data.extend_from_slice(&amount.to_le_bytes());

    let instruction = Instruction {
        program_id,
        accounts: account_metas,
        data: instruction_data,
    };

    invoke(
        &instruction,
        &[
            ctx.accounts.sender.to_account_info(),
            ctx.accounts.recipient.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    Ok(())
}
