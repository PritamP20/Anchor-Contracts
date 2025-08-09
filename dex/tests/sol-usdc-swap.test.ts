import { describe, it, beforeAll } from 'bun:test';
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Dex } from "../target/types/dex";
import { assert } from "chai";
import {
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import keccak256 from "keccak256";

// NOTE: We avoid hitting Jupiter network in CI/devnet to keep tests deterministic.
// We'll craft a bincode-compatible Instruction buffer so the on-chain bincode::deserialize
// can parse it into solana_program::instruction::Instruction

describe("SOL to USDC Swap Test (fixed)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const program = anchor.workspace.dex as Program<Dex>;
  const connection = provider.connection;

  let sessionPda: PublicKey;
  let jupiterIxPda: PublicKey;

  // Token addresses
  const SOL_MINT = NATIVE_MINT; // Native SOL
  const USDC_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"); // devnet USDC
  const JUPITER_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

  // Swap parameters
  const swapAmount = Math.floor(0.01 * LAMPORTS_PER_SOL); // integer lamports
  const salt = new Uint8Array(32).fill(42); // deterministic "random" salt for tests

  beforeAll(async () => {
    console.log("Setting up SOL to USDC swap test...");
    console.log(`Wallet: ${provider.wallet.publicKey.toBase58()}`);

    // Create PDAs (same as on-chain seeds)
    [sessionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );

    [jupiterIxPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("jupiter_ix"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );

    console.log(`Session PDA: ${sessionPda.toBase58()}`);
    console.log(`Jupiter IX PDA: ${jupiterIxPda.toBase58()}`);
  });

  it("Should commit SOL to USDC swap", async () => {
    console.log("\n🔐 Creating commitment for SOL->USDC swap...");

    const tokenIn = SOL_MINT;
    const tokenOut = USDC_DEVNET;

    // Create commitment hash
    const commitmentData = Buffer.concat([
      tokenIn.toBuffer(),
      tokenOut.toBuffer(),
      Buffer.from(new anchor.BN(swapAmount).toArray("le", 8)),
      Buffer.from(salt),
    ]);
    const commitment = keccak256(commitmentData); // returns Buffer

    const tx = await program.methods
      .commitSwap(Array.from(commitment))
      .accounts({
        session: sessionPda,
        user: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Commitment created. TX: ${tx}`);

    // Verify commitment
    const session = await program.account.swapSession.fetch(sessionPda);
    assert.deepEqual(Array.from(session.commitment), Array.from(commitment));
    assert.equal(session.revealed, false);
    assert.equal(session.user.toBase58(), provider.wallet.publicKey.toBase58());
  });

  it("Should store a bincode-encoded Jupiter instruction and reveal (deterministic)", async () => {
    console.log("\n💾 Storing a bincode-encoded Jupiter instruction (mocked) ...");

    // Construct a bincode-compatible serialization for `Instruction`:
    // [program_id (32 bytes)] [accounts_len: u64 LE (8 bytes)] [for each account: (pubkey 32)+(u8 is_signer)+(u8 is_writable)] [data_len: u64 LE (8 bytes)] [data bytes]
    //
    // We'll use 0 accounts (accounts_len = 0) and a small data payload.

    const programIdBytes = JUPITER_PROGRAM_ID.toBuffer(); // 32 bytes
    const accountsLenBuf = Buffer.alloc(8);
    accountsLenBuf.writeBigUInt64LE(0n, 0); // 0 accounts

    const dataPayload = Buffer.from([1, 2, 3, 4, 5]); // mock swap data
    const dataLenBuf = Buffer.alloc(8);
    dataLenBuf.writeBigUInt64LE(BigInt(dataPayload.length), 0);

    // Final bincode-like buffer:
    const bincodeInstruction = Buffer.concat([programIdBytes, accountsLenBuf, dataLenBuf, dataPayload]);

    // Store the instruction on-chain (your program stores raw bytes in JupiterInstructionAccount.data)
    const storeTx = await program.methods
      .storeJupiterInstruction(Array.from(bincodeInstruction))
      .accounts({
        instructionAccount: jupiterIxPda,
        user: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Jupiter instruction stored. TX: ${storeTx}`);

    const storedInstruction = await program.account.jupiterInstructionAccount.fetch(jupiterIxPda);
    assert.equal(storedInstruction.user.toBase58(), provider.wallet.publicKey.toBase58());
    assert.isTrue(storedInstruction.data.length > 0);

    // Now attempt reveal & swap. We expect CPI to likely fail on devnet (no real Jupiter),
    // but our on-chain logic sets session.revealed = true BEFORE CPI, so we assert that.
    console.log("\n🔓 Revealing commitment and executing swap (CPI may fail but reveal should pass) ...");

    try {
      const revealTx = await program.methods
        .revealAndSwapWithStoredIx(
          Array.from(salt),
          SOL_MINT,
          USDC_DEVNET,
          new anchor.BN(swapAmount)
        )
        .accounts({
          session: sessionPda,
          instructionAccount: jupiterIxPda,
          user: provider.wallet.publicKey,
          tokenProgram: anchor.web3.TOKEN_PROGRAM_ID, // anchor exports token program id as well, but this keeps types consistent
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
        ])
        .rpc();

      console.log(`✅ revealAndSwapWithStoredIx TX: ${revealTx}`);
    } catch (err: any) {
      console.log(`⚠️  revealAndSwapWithStoredIx errored (expected in mocked/test env): ${err.message}`);
      // Continue, we'll still verify session state below.
    }

    const sessionAfter = await program.account.swapSession.fetch(sessionPda);
    assert.equal(sessionAfter.revealed, true, "Session must be marked revealed even if CPI failed");
  });

  it("Should demonstrate direct reveal with inline Jupiter instruction (empty -> no CPI)", async () => {
    console.log("\n🔄 Testing direct reveal with inline Jupiter data (empty) ...");

    // Create a fresh commitment with a fresh salt
    const freshSalt = new Uint8Array(32).fill(99);
    const commitmentData = Buffer.concat([
      SOL_MINT.toBuffer(),
      USDC_DEVNET.toBuffer(),
      Buffer.from(new anchor.BN(swapAmount).toArray("le", 8)),
      Buffer.from(freshSalt),
    ]);
    const commitment = keccak256(commitmentData);

    // Commit
    await program.methods
      .commitSwap(Array.from(commitment))
      .accounts({
        session: sessionPda,
        user: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Reveal with empty Jupiter data (skips CPI)
    const revealTx = await program.methods
      .revealAndSwap(
        Array.from(freshSalt),
        SOL_MINT,
        USDC_DEVNET,
        new anchor.BN(swapAmount),
        Buffer.alloc(0)
      )
      .accounts({
        session: sessionPda,
        user: provider.wallet.publicKey,
        tokenProgram: anchor.web3.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Direct reveal completed (no swap executed). TX: ${revealTx}`);

    const session = await program.account.swapSession.fetch(sessionPda);
    assert.equal(session.revealed, true);
  });

  it("Should test commitment validation with wrong parameters", async () => {
    console.log("\n❌ Testing commitment validation with wrong salt ...");

    const wrongSalt = new Uint8Array(32).fill(255);

    // Create commitment with original `salt`
    const commitmentData = Buffer.concat([
      SOL_MINT.toBuffer(),
      USDC_DEVNET.toBuffer(),
      Buffer.from(new anchor.BN(swapAmount).toArray("le", 8)),
      Buffer.from(salt),
    ]);
    const commitment = keccak256(commitmentData);

    await program.methods
      .commitSwap(Array.from(commitment))
      .accounts({
        session: sessionPda,
        user: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Try to reveal with wrong salt
    try {
      await program.methods
        .revealAndSwap(
          Array.from(wrongSalt),
          SOL_MINT,
          USDC_DEVNET,
          new anchor.BN(swapAmount),
          Buffer.alloc(0)
        )
        .accounts({
          session: sessionPda,
          user: provider.wallet.publicKey,
          tokenProgram: anchor.web3.TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      assert.fail("Should have failed with commitment mismatch");
    } catch (error: any) {
      console.log(`✅ Commitment validation triggered: ${error.message}`);
      assert.isTrue(
        error.message.includes("CommitmentMismatch") ||
          error.message.includes("6002") ||
          error.toString().toLowerCase().includes("commitment")
      );
    }
  });

  it("Should test cancel commitment functionality", async () => {
    console.log("\n🚫 Testing commitment cancellation...");

    const cancelSalt = new Uint8Array(32).fill(123);

    // Create commitment
    const commitmentData = Buffer.concat([
      SOL_MINT.toBuffer(),
      USDC_DEVNET.toBuffer(),
      Buffer.from(new anchor.BN(swapAmount).toArray("le", 8)),
      Buffer.from(cancelSalt),
    ]);
    const commitment = keccak256(commitmentData);

    await program.methods
      .commitSwap(Array.from(commitment))
      .accounts({
        session: sessionPda,
        user: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Cancel commitment
    const cancelTx = await program.methods
      .cancelCommitment()
      .accounts({
        session: sessionPda,
        user: provider.wallet.publicKey,
      })
      .rpc();

    console.log(`✅ Commitment cancelled. TX: ${cancelTx}`);

    // Verify cancellation
    const session = await program.account.swapSession.fetch(sessionPda);
    assert.equal(session.revealed, false);

    const zeroCommitment = new Array(32).fill(0);
    assert.deepEqual(Array.from(session.commitment), zeroCommitment);
  });
});
