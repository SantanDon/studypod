# StudyPod Passage Finder

Ask the weekly guide a question such as “What should I do on Friday?” and open the cited GitHub line. Each answer quotes a passage from the same commit as its link. An ambiguous or unrelated question asks you to try again.

Built for Hacksgiving 2026 as a new agent in the existing StudyPod project. Its public reading list currently contains the weekly revision guide in this folder.

## Run on a Sprite

Grant the Sprite access to a GitHub connector named `github` in the Fly dashboard. From this directory run `node server.mjs` with Node 22 or newer. Open the Sprite URL on port 8080. For persistent hosting, create a Sprite service using the absolute path to server.mjs as the argument to node.

The agent reads one fixed public file. Its default requests go through the Sprites gateway. For a local preview using the public GitHub API, run `node server.mjs --public-preview` and open http://localhost:8080. That preview tests passage retrieval separately from the hosted connector.
