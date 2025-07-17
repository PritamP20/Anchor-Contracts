import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Calculator } from "../target/types/calculator";
import { assert } from "chai";

describe("calculator", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Calculator as Program<Calculator>;
  const newAccount = anchor.web3.Keypair.generate();

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().accounts({
      newAccount: newAccount.publicKey,
      signer: anchor.getProvider().publicKey,
    })
    .signers([newAccount])
    .rpc();
    console.log("Your transaction signature", tx);
  });

  it("Is double!", async ()=>{
    const tx = await program.methods.double().accounts({
      account: newAccount.publicKey,
      signer: anchor.getProvider().publicKey,
    })
    .rpc();
    console.log("Your transaction signature", tx);
    const account = await program.account.newAccount.fetch(newAccount.publicKey);
    assert.equal(account.data, 2);
  })

  it("halve!", async ()=>{
    const tx = await program.methods.halve().accounts({
      account: newAccount.publicKey,
      signer: anchor.getProvider().publicKey,
    })
    .rpc();
    console.log("Your transaction signature", tx);
    const account = await program.account.newAccount.fetch(newAccount.publicKey);
    assert.equal(account.data, 1);
    })    
  })