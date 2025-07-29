import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CpiContracts } from "../target/types/cpi_contracts";
import { assert } from "chai";

describe("cpi-contracts", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const recipient = anchor.web3.Keypair.generate();
  const program = anchor.workspace.cpiContracts as Program<CpiContracts>;
  console.log(program, "program");
  console.log("idl", program.idl);
  console.log("program id", program.programId.toString());

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.solTransfer(new anchor.BN(1000000)).accounts({
      sender: provider.publicKey,
      recipient: recipient.publicKey,
    }).rpc();
    console.log("Your transaction signature", tx);
    const account = await provider.connection.getAccountInfo(recipient.publicKey);
    assert.equal(account?.lamports, 1000000);
  });
}); 
