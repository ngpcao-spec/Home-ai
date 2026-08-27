import { createServer } from "node:http";
import { createApp } from "./api.js";

const port = Number(process.env.PORT || 3000);
createServer(createApp()).listen(port, () => console.log(`Home-ai listening on port ${port}`));
