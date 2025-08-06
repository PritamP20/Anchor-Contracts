import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Dex } from "../target/types/dex";
import { assert } from "chai";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from "@solana/spl-token";
import keccak256 from "keccak256"

describe("dex", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const program = anchor.workspace.dex as Program<Dex>;

  let user = Keypair.generate();
  let mint: PublicKey;
  let tokenAccount: PublicKey;
  let treasuryAccount: PublicKey;
  let commitment: Uint8Array;
  let sessionPda: PublicKey;
  let sessionBump: number;
  const amount = 500_000;
  const salt = new Uint8Array(32).fill(1);

  it("Creates mint and token accounts", async () => {
    mint = await createMint(
      provider.connection,
      provider.wallet.payer,
      provider.wallet.publicKey,
      null,
      6 
    );

    tokenAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint,
      provider.wallet.publicKey
    )).address;

    treasuryAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint,
      provider.wallet.publicKey // Replace with treasury address if needed
    )).address;

    await mintTo(
      provider.connection,
      provider.wallet.payer,
      mint,
      tokenAccount,
      provider.wallet.payer,
      1_000_000_000
    );

    console.log()

    assert.ok(true);
  });

  it("Commits a swap", async () => {
    const tokenIn = mint;
    const tokenOut = mint; // For test simplicity, same mint
    const amount = 500_000;
    const salt = new Uint8Array(32).fill(1);
    const buf = Buffer.concat([
      tokenIn.toBuffer(),
      tokenOut.toBuffer(),
      Buffer.from(new anchor.BN(amount).toArray("le", 8)),
      Buffer.from(salt)
    ]);
    const hash = keccak256(buf);
    commitment = hash;
    

    [sessionPda, sessionBump] = await PublicKey.findProgramAddress(
      [Buffer.from("session"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    console.log(program.programId.toBase58())
    await program.methods.commitSwap(Array.from(commitment)).accounts({
      session: sessionPda,
      user: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    }).rpc();

    const session = await program.account.swapSession.fetch(sessionPda);
    assert.deepEqual(session.commitment, Array.from(commitment));
    assert.isFalse(session.revealed);
  });

  it("Reveals and swaps", async () => {
    const tokenIn = mint;
    const tokenOut = mint;

    // Create commitment
    const buf = Buffer.concat([
      tokenIn.toBuffer(),
      tokenOut.toBuffer(),
      Buffer.from(new anchor.BN(amount).toArray("le", 8)),
      Buffer.from(salt),
    ]);
    const hash = keccak256(buf);
    const commitment = Uint8Array.from(Buffer.from(hash, "hex"));

    // Commit phase
    await program.methods.commitSwap([...commitment]).accounts({
      session: sessionPda,
      user: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    }).rpc();

    const dummyIx = new anchor.web3.TransactionInstruction({
      keys: [],
      programId: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
      data: Buffer.from([]),
    });

    const serializedIx = Buffer.from(
      JSON.stringify({
        program_id: dummyIx.programId.toBase58(),
        keys: dummyIx.keys.map(k => ({
          pubkey: k.pubkey.toBase58(),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        data: [...dummyIx.data],
      }),
      'utf-8'
    );


    const jupiterIxSerialized = dummyIx.data; // or construct manually if needed

    // Reveal phase
    await program.methods.revealAndSwap(
      [...salt],
      tokenIn,
      tokenOut,
      new anchor.BN(amount),
      serializedIx
    ).accounts({
      session: sessionPda,
      user: provider.wallet.publicKey,
      jupiterProgram: dummyIx.programId,
      outTokenAccount: tokenAccount,
      treasuryTokenAccount: treasuryAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).remainingAccounts([]).rpc();

    // Validations
    const session = await program.account.swapSession.fetch(sessionPda);
    assert.isTrue(session.revealed);
    assert.deepEqual(session.commitment, [...commitment]);

    const treasury = await getAccount(provider.connection, treasuryAccount);
    const expectedFee = Math.floor(amount / 1000);
    assert.isAtLeast(Number(treasury.amount), expectedFee);
  });

  // it("Cancels commitment", async () => {
  //   await program.methods.cancelCommitment().accounts({
  //     session: sessionPda,
  //     user: provider.wallet.publicKey,
  //   }).rpc();

  //   const session = await program.account.swapSession.fetch(sessionPda);
  //   assert.deepEqual(session.commitment, new Array(32).fill(0));
  //   assert.isFalse(session.revealed);
  // });

  // Note: reveal_and_swap test will need actual Jupiter serialized instruction and proper remaining accounts,
  // which requires integration with Jupiter, not suitable for a unit test without mock data.
});


