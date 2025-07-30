use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    entrypoint,
    program_error::ProgramError,
    pubkey::Pubkey,
    system_instruction::create_account,
    system_program::ID as SYSTEM_PROGRAM_ID,
};

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8]
)->ProgramResult{
    let iter = &mut accounts.iter();
    let payer_account = next_account_info(iter)?;
    let pda_accoint = next_account_info(iter)>;
    let payer_pubkey = payer_account.key;
    let system_prgram = next_account_info(iter)?;

    let (pda, bump) = Pubkey::find_program_address(
        &[b"pda_account", payer_pubkey.as_ref()],
        &program_id,
    );

    let ix = create_account(
        &payer_pubkey,
        &pda,
        1_000_000, // Minimum rent-exempt balance
        0, // Space for the PDA account
        &program_id,
    )
    let signer_seeds = &[&[b"pda_account", payer_pubkey.as_ref(), &[bump]]];
    invoke_signed(&ix, accounts, &[signer_seeds])?;
    msg!("PDA created: {}", pda);
    Ok(())
}