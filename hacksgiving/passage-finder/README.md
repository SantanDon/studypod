# StudyPod Passage Finder

Ask the weekly guide a question such as “What should I do on Friday?” and open the cited GitHub line. Each answer quotes a passage from the same commit as its link. An ambiguous or unrelated question asks you to try again.

Built for Hacksgiving 2026 as a new agent in the existing StudyPod project. Its public reading list currently contains the weekly revision guide in this folder.

## Run on a Sprite

Review the GitHub authorization screen before granting this Sprite access to the connector named `github`. The standard connector requests access to public and private repositories and read access to organization membership. The demo itself only reads the public guide. From this directory run `node server.mjs` with Node 22 or newer. Open the Sprite URL on port 8080. For persistent hosting, create a Sprite service using the absolute path to server.mjs as the argument to node.

The agent reads one fixed public file. Its default requests go through the Sprites gateway. For a local preview using the public GitHub API, run `node server.mjs --public-preview` and open http://localhost:8080. That preview tests passage retrieval separately from the hosted connector.

## Check the answers locally

From this folder, run `node --test match.test.mjs server.test.mjs` with Node 22 or newer. The tests use the included guide and a simulated connector response. They check weekday questions, unrelated questions, and whether the HTTP answer quotes the exact line and revision in its link. To check the real connector, open the hosted Sprite, ask the Friday question, and compare the displayed quote with the highlighted line on GitHub.
