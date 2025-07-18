use anchor_lang::prelude::*;

declare_id!("2JUq1HtSi9znKbSWwe3b37xTA7V96CcHdLiFmwmmG4DA");

#[program]
pub mod prediction_market {
    use super::*;
    pub fn create_market(
        ctx: Context<CreateMarket>,
        question: String,
        outcomes: Vec<String>,
        resolution_time: i64,
    ) -> Result<()>{
        let market = &mut ctx.accounts.market; //this is poinnting to the new accoutn which was created during the struct instruction phase
    }
}

#[derive(Accounts)] // creating a market account like eg ipl teams csk, rcb etc
#[instruction(question:String, outcomes: Vec<String>, resolution_time: i64)] // i didn't understand this
pub struct CreateMarket<'info> {
    #[account(
        init,
        payer=authority,
        space=8 + 32 + 4 + 200 + 4 + 2 * 50 + 8 + 1 + 4 + 2 * 8 + 1 + 8,
        seeds = [b"market", authority.key().as_ref(), question.as_bytes()], //y are we adding this line
        bump
    )]
    let pub market: Account<'info, Market>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>
}

#[derive(Accounts)] // an accouint which will have the details about which team / market did the user bet on
#[instruction(outcome_index:u8, amount: u64)] // the arguments the user will provide
pub struct PlaceBet<'info>{
    #[account(mut, has_one = authority)] // so this is checking the market account whether it is from the correct authority or not
    pub market: Account<'info, Market>, // the market account to bet on
    #[account(
        init,
        payer = bettor,
        space = 8+32+1+8,
        seeds = [b"bet", market.key().as_ref(), bettor.key().as_ref()],
        bump
    )] // this macro is used to create a required bet account
    pub bet: Account<'info, Bet>,
    #[account(mut)]
    pub bettor: Signer<'info>, 
    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
#[instruction(winning_outcome:u8)]
pub struct ResolveMarket<'info> {
    #[account(mut, has_one=authority)]
    pub market: Account<'info, Market>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimPayout<'info>{
    #[account(has_one = authority)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub bet: Account<'info, Bet>,
    #[account(mut)] // Mutable bettor account to receive payout.
    pub bettor: Signer<'info>, // Bettor must sign.
}

#[account]
pub struct Bet{
    pub bettor: Pubkey,
    pub outcome_index: u8,
    pub amount: u64
}

#[account]
pub struct Market{
    pub authority: Pubkey,
    pub question: String,
    pub outcomes: Vec<String>,
    pub resolution_time: i64,
    pub resolved: bool,
    pub winning_outcome: Option<u8> // this one is doubt option is given because at the start is None after the resolution time the winner index is decided so we wait until then
    pub total_bets: Vec<u64>,
    pub is_active: bool
}

#[error_code]
pub enum ErrorCode{
    #[msg("Msrket is not active")] MarketNotActive,
    #[msg("Invalid number of outcomes")] InvalidOutcomeCount,
    #[msg("Invalid resolution time")] InvalidResolutionTime,
    #[msg("Question is too long")] QuestionTooLong,
    #[msg("Invalid outcome index")] InvalidOutcome,
    #[msg("Market not resolvable yet")] MarketNotReslvable,
    #[msg("Market not resolved")] MarketNotResolved,
    #[msg("Not as winning bet")] NotWinningBet,
    #[msg("No payout available")] NoPayout,
    #[msg("Unauthorized access")] Unauthorized,
}

