use anchor_lang::prelude::*;

declare_id!("4uMygmbnQqmR2YQWsEh6sR4a22KBqMk6aHkQgH7rHQRK");

#[program]
pub mod pda_using_anchor {
    use super::*;

    pub fn create_pda_account(ctx: Context<CreatePdaAccount>) -> Result<()> {
        msg!("PDA account created successfully!");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreatePdaAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8+32+8+1, // space for discriminator, owner public key,  staked_amount, bump
        seeds = [b"client1", payer.key().as_ref()],
        bump
    )]
    pub pda_account: Account<'info, PdaAccount>,
    pub system_program: Program<'info, System>,

}
