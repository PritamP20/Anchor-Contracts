import { it, describe, beforeAll, expect } from 'bun:test';
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Dex } from "../target/types/dex";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo } from "@solana/spl-token";
import { assert } from "chai";

describe("dex", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Dex as Program<Dex>;
  const user = provider.wallet as anchor.Wallet;

  let mintA: PublicKey;
  let mintB: PublicKey;
  let userTokenA: PublicKey;
  let userTokenB: PublicKey;
  let programTokenA: PublicKey;   
  let programTokenB: PublicKey;
  let treasuryToken: PublicKey;
  let sessionPda: PublicKey;
  let sessionBump: number;
  

  beforeAll(async () => {
    // Create two mints
    mintA = await createMint(provider.connection, user.payer, user.publicKey, null, 6);
    mintB = await createMint(provider.connection, user.payer, user.publicKey, null, 6);

    // Create token accounts
    userTokenA = await createAccount(provider.connection, user.payer, mintA, user.publicKey);
    userTokenB = await createAccount(provider.connection, user.payer, mintB, user.publicKey);
    programTokenA = await createAccount(provider.connection, user.payer, mintA, program.programId);
    programTokenB = await createAccount(provider.connection, user.payer, mintB, program.programId);
    treasuryToken = await createAccount(provider.connection, user.payer, mintA, program.programId);

    // Mint some tokens to user
    await mintTo(provider.connection, user.payer, mintA, userTokenA, user.publicKey, 1_000_000_000);
  await mintTo(provider.connection, user.payer, mintA, programTokenA, user.publicKey, 1_000_000_000);
  await mintTo(provider.connection, user.payer, mintB, programTokenB, user.publicKey, 1_000_000_000);

    // Derive session PDA
    [sessionPda, sessionBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("session"), user.publicKey.toBuffer()],
      program.programId
    );
  });

  it("commit swap", async () => {
    const salt = Buffer.alloc(32, 9); // dummy
    const amount = new anchor.BN(100_000);
    const buf = Buffer.concat([
      mintA.toBuffer(),
      mintB.toBuffer(),
      Buffer.alloc(8, 0), // amount little endian placeholder
      salt
    ]);
    buf.writeBigUInt64LE(BigInt(amount.toString()), 32); // fix encoding

    const commitment = anchor.utils.sha256(buf);

    await program.methods
      .commitSwap(commitment)
      .accounts({
        session: sessionPda,
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const sess = await program.account.swapSession.fetch(sessionPda);
    assert.deepEqual(sess.commitment, commitment);
    assert.isFalse(sess.revealed);
  });

  it("reveal and swap (mock Jupiter)", async () => {
    // We'll just call with dummy accounts for Jupiter CPI since we're not actually swapping
    const salt = Buffer.alloc(32, 9);
    const amount = new anchor.BN(100_000);
    const buf = Buffer.concat([
      mintA.toBuffer(),
      mintB.toBuffer(),
      Buffer.alloc(8, 0),
      salt
    ]);
    buf.writeBigUInt64LE(BigInt(amount.toString()), 32);
    const commitment = anchor.utils.sha256(buf);

    // route_plan empty for mock
    await program.methods
      .revealAndSwap(
        [...salt],
        mintA,
        mintB,
        amount,
        new anchor.BN(0), // id
        [], // route plan
        new anchor.BN(0), // quoted_out_amount
        50, // slippage_bps
        0   // platform_fee_bps
      )
      .accounts({
        session: sessionPda,
        user: user.publicKey,
        jupiterProgram: JUPITER_PROGRAM_ID, // we can deploy a mock program here if needed
        tokenProgram: TOKEN_PROGRAM_ID,
        userTransferAuthority: user.publicKey,
        sourceTokenAccount: userTokenA,
        programSourceTokenAccount: programTokenA,
        programDestinationTokenAccount: programTokenB,
        destinationTokenAccount: userTokenB,
        sourceMint: mintA,
        destinationMint: mintB,
        platformFeeAccount: treasuryToken,
        token2022Program: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const sess = await program.account.swapSession.fetch(sessionPda);
    assert.isTrue(sess.revealed);
  });

  it("collect protocol fee", async () => {
    const amount = new anchor.BN(1_000_000);

    await program.methods
      .collectProtocolFee(amount)
      .accounts({
        session: sessionPda,
        user: user.publicKey,
        sourceTokenAccount: programTokenA,
        treasuryTokenAccount: treasuryToken,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // In a real test, fetch balances and check fee deduction
  });
});
