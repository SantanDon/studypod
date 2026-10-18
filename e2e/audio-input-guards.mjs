import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
export const adoptedAudioPins = Object.freeze({
  "backend/src/services/podcastChunkRepository.js": "151b4b6235d6d7d910f202d2dc4550e87601525e1e155fd2b8aa816fd4f2fffd",
  "backend/src/services/podcastRepository.js": "713b25cecb16beb8bd7dcd8b586f0af876947552f087f5ec0599f7937f2ea472",
  "backend/src/routes/podcasts.js": "2e18ff0cae2f2cb8dfd6b7fd3ee406ef1527243f33ba540b8d4c61e5712bf930",
  "src/services/podcastApiService.ts": "7c00b6fb0a287678b2c568a5dc053eafa85be29ced615083827f6e31634d2eae",
  "backend/src/utils/chatRequestBudget.js": "941018d0790279770b4f022f87e1abc8041dff9c921860b2536586260a6cda31",
  "backend/src/services/aiChatService.js": "3cbf8f2980aadd5622e11a2ddb70439ab55767870c63c6a02d5eea6d46afc7bb",
  "backend/src/routes/notebooks.js": "0af1c60a64ad4c663b817a541cf1d8596f506448566960094209eb5ac525a85f",
  "e2e/helpers/cedarExtendedNoteOracle.mjs": "13251b3afec3ca9bd14b730b3efac33323cf0a5fc0516fc110d7a1d2b3a9cbe0",
  "e2e/studio-audio.pw.ts": "42cc7c049f32cd50a407e2f132af2b0c4e0eaac5b63826b1a94d7682a024aaca",
  "e2e/native-disposal-oracle.ts": "4ba0f4ef56404acfc7c388d1d4b1d846183ed8ffa6a0c9a2922af521896ffaa1",
  "e2e/acceptance-contracts.mjs": "01e30c2457b21cf84c07c56c28f545509208dce229710e4ad3e93b0007cab83f",
  "src/components/notebook/StudioSidebar.tsx": "29c0c177d653289f28c7002b6aae206b7847b24e3f6f905c005539b4d239fa1c",
  "src/lib/flashcards/flashcardGenerator.ts": "740977bda245bd53874f4f35bc828e30ad430c3d6bf4d894316cf43cf84813e9",
  "e2e/source-downstream.pw.ts": "42b2b6d47df8e01265cd7a205a3abe2adc618b967034f29c2536d8461487dbc5",
  "e2e/youtube-response-acceptance.mjs": "46a6aa63eae3a31524d323825b3a2b96fee67df6c90eb5d61fc59792f36dea4e",
  "e2e/youtube-question-oracle.mjs": "0fd0619ca288ee143b5b58b62fca41bf5ed65c8c94f89fb393967a7286fb3529",
  "e2e/full-flow-fixtures.mjs": "24f76a7e45bc37b614a71fdc7fca5b66816733208da270c49bd9f77fe853a224",
  "src/components/notebook/PodcastView.tsx": "6b476b588c14c96acc704b7bdf70c320dbfece765163e44c0ba6393c58c2d3ab",
  "src/components/notebook/SourcesSidebar.tsx": "ec28c30b75e8af7b7a295177b85e9ee91575f2f8bdb3c18312194e0f20f226c1",
  "src/components/notebook/PodcastHistory.tsx": "e56ad7b531bddd5d808d2d4ba9bacae74cb2ea86301d3009fa3bc74fd1ad1b37",
  "src/components/notebook/AudioPlayer.tsx": "4dbcc7e2821a95821a61923209819dbca86fcf767095a3378cb157acf969f614",
  "src/components/notebook/hooks/useAudioPlayer.ts": "5cb29f99623eb81c35350a6115b201371d05f6d7ff9c05653c3364604b3fe413",
  "e2e/full-flow.config.ts": "81a52e8b4323c5c31eec708d96f02a51a5c359ab58e42f1ae2c57464edb17305",
  "e2e/full-flow-reporter.ts": "a4c809d90a2f8940a5e16fe1804954defcfa48377e820e3b1fabac0ef2921633",
  "e2e/helpers/flashcard-count-diagnostics.mjs": "6f167e77be3d6540416f76f64a40d393844288ff19d4b2b40850f1dfeb26ed7a",
  "e2e/populated-notebook-deletion.pw.ts": "2e45d69d74ada637883a948332816d8d42b4448f9eb4b7bf647007a2513fe0e8",
  "e2e/helpers/accountLifecycle.ts": "ded2d922dc08b0b58b61a32078459dfe430eb4222e3b09e046d1fb861e8b5587",
  "src/lib/utils/displayTitle.ts": "7a239ab2dc35ab4b130d4b4215950118274166fb02d1f25999ac82aa3ebce7d3",
  "e2e/audio-generation-budget.ts": "9cc49a359855daa0099478a8433904d88ec0329c3d70f4cb662bbdee7a79be95",
  "e2e/source-prose-oracle.mjs": "ffebe1a9dfc3520141bec0a59c258fac4c440669e6ddd4c3f5d45ff13d5bd666",
  "e2e/source-prose-fixtures.mjs": "82263cc8b2e9982e90b5597cab31c2f7b95c83aefa23b5e13328b66f31ffcad6",
  "e2e/helpers/notebook-row-audit.mjs": "1e7c57b8537d0ef23ba50844f4cf1afa721bff3d920425848616453af5b2c7b4",
  "e2e/account-lifecycle.pw.ts": "c5e81af1e91ba6682fc5f1a3d53847e2a45af8d885613af65a71e5792232cbac",
  "e2e/full-flow.pw.ts": "0167541db51e6c9641a204844ea5a36b0733cc9dbe8affbe30de0ebfb272379e",
  "e2e/helpers/cedarMapOracle.ts": "c54a8498047990eb08fe79e12c195e65e4425cf75e8293c48731739dc99353c4",
  "e2e/flashcard-ratio-diagnostics.ts": "acb6049e2940a80c962832e2d9b9d5aed8cd2d8f89f3f1fb2656e5cc0e4e58b1",
  "e2e/source-interaction.pw.ts": "642b73d0c73844e09ec7ea796731d761e3040d5f6ef86c85a6c5b685a37e0382",
  "e2e/studio-chat-actions.pw.ts": "422b26f8fb25da814088eaa30211283001dccbac88d04f732229e62089b161fe",
  "e2e/helpers/cedarStatementOracle.ts": "445e95f2a1b304a2feb9bb4dabe34bc5b04bcdf83b97faa829a80ea43a58df5a",
  "e2e/studio-extended.pw.ts": "aed31341587d85405778fd92f3e378b44d316a2097197b55d613000660b1fe69",
  "e2e/audio-fidelity.integration.ts": "7ee2dd300b09ff3684dc428308938621f69b7b5f8e4ef449f9aee3a96e1593df",
  "e2e/audio-fidelity.helpers.mjs": "54bc046a853425dd134b702d470247109de0b300aeb93a41bdb5bdf6a808edf7",
  "e2e/audio-fidelity.facts.mjs": "362b81c9c178d5239ed11e3a4bc9bae0c47d7891651a8909f336c084f3d21b77",
  "e2e/studio-quiz-journey.pw.ts": "2f7765ac4f8147bd6f1ecbfb0dee03fba9cdae4c6557facc23f306d1343bc85a",
  "e2e/helpers/cedarFactOracle.ts": "178beb863e4b867306e92aef3f1be0ba833a00eaa1650a3d098f41555d1bf433",
  "src/types/quiz.ts": "cf134d9124e819ba280245e7373ff46016e734a518e1208908748368af1086ee",
  "e2e/studio-task-capture.pw.ts": "a4287c352b0ca7cfad1d9e0487fc6a4007dc5acb4489bd96b67a3fb950296273",
  "e2e/studio-flashcard-review.pw.ts": "b29afb1fd7f03d80338d73c071239ca9fb2d465994229a8ce0d4e3af67ea3ff5",
  "src/types/flashcard.ts": "ac4c68dc656d55fbd71a232c5ddf4715e1ab3a3f0a8f850ed331015f654041df",
  "e2e/studio-quiz-true-false.pw.ts": "0399de3bd14f6dc2cf4de57a3890cb1b85507442caba786f7a4b9bb0e475f7fe",
  "e2e/module-load-recovery.pw.ts": "f1510187961b4fde839ef0ca181672b5ffd5e9b91bf6b0f36f49c609ae499975",
  "e2e/guest-upload-recovery.pw.ts": "f6e7f3768b356456042d5440caaa1d654f8dfa35172b8cf8752841b03b4744b8",
  "e2e/signed-in-upload-recovery.pw.ts": "85dd0856b2d42e9683ff95c300103b7fffdf8ae992c31964174008a2c72d0ca4",
  "e2e/upload-validation.pw.ts": "1000744fdaa08e7c951736fc5cee6bad91647c88f139f09924d708ce78c1d748",
  "e2e/source-save-outage.pw.ts": "f955f9304e3b972051381c5ab40892fdeb5909f593f723d40510514acd21bf1c",
  "e2e/upload-queue-reload.pw.ts": "4d74a97149dd003f7c38842293037031673d05e9ef687df1566ad6083117a946",
  "e2e/guest-upload-queue-reload.pw.ts": "0c49240279f7decd8ae8e7f4e2b331e10c2f2f8974024fbdc1390ede3f71eb99",
  "e2e/run-full-flow-local.mjs": "a915557087474a6e8f21c9d64d640ffb165cecb32504840209a43f072eb4ce2f",
  "e2e/candidate-inputs.mjs": "1ceb31325060c45ebab65c99c5bd99477e8ff3d7174dc1e53137df85c05babc3",
  "e2e/full-flow-decision.mjs": "a1541a19c25373b729fc7f0fdecb9fb5bdf33204cdab7743753cb848d6da6391",
  "src/components/notebook/PodcastView.css": "93f12d599a86f431a3045624381e1defe2bc49aa8ff769cd3bbaea3948417244"
});
// Fail before fixtures, credentials, build, services, browser or provider dispatch.
// Dynamic whole-source/build fingerprints remain the run's evidence binding.
export async function verifyAdoptedAudioInputs(root, sourceFingerprint, read = readFile) {
  const inventory = await sourceFingerprint(root);
  const entries = new Map(inventory.files.map(file => [file.path, file]));
  for (const [path, expected] of Object.entries(adoptedAudioPins)) {
    const actual = createHash('sha256').update(await read(resolve(root, path))).digest('hex');
    const entry = entries.get(path);
    if (actual !== expected || !entry || entry.absent || entry.sha256 !== expected) {
      throw new Error('Adopted audio input guard failed: ' + path);
    }
  }
  return { guardPassed:true, pins:adoptedAudioPins, inventoryIncludesDisposalHelper:true };
}
