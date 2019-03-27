const Api = require('@dashevo/dapi-client');
const { SpvChain, MerkleProof } = require('@dashevo/dash-spv');
const dashcore = require('@dashevo/dashcore-lib');

// Height used for poc (to save syncing time)
const pocBestHeight = 2896;

// Go back 20 blocks
// Todo: DGW not allowing more than 24 blocks, low difficulty regtest problem
const pocGenesis = pocBestHeight - 20;

let nullHash;
let api = null;
let headerChain = null;

const log = console;

async function logOutput(msg, delay = 50) {
  log.info(`${msg}`);
  await new Promise(resolve => setTimeout(resolve, delay));
}

// ==== Client initial state

async function init() {
  api = new Api();
  // using genesis as nullhash as core is bugged
  nullHash = await api.getBlockHash(0);
}

// ==== Client initial state

// ==== Build HeaderChain

async function getValidatedHeaderchain() {
  const dapinetGenesisHash = await api.getBlockHash(pocGenesis);
  const dapinetGenesisHeader = await api.getBlockHeader(dapinetGenesisHash);
  dapinetGenesisHeader.prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
  dapinetGenesisHeader.bits = +(`0x${dapinetGenesisHeader.bits}`);
  const numConfirms = 10000;

  headerChain = new SpvChain('custom_genesis', numConfirms, dapinetGenesisHeader);

  const maxHeaders = 24;
  for (let i = pocGenesis + 1; i <= pocBestHeight; i += maxHeaders) {
    /* eslint-disable-next-line no-await-in-loop */
    const newHeaders = await api.getBlockHeaders(i, maxHeaders);
    headerChain.addHeaders(newHeaders);
  }

  // NOTE: query a few nodes by repeating the process to make sure you on the longest chain
  // headerChain instance will automatically follow the longest chain, keep track of orphans, etc
  // implementation detail @ https://docs.google.com/document/d/1jV0zCie5rVbbK9TbhkDUbbaQ9kG9oU8XTAWMVYjRc2Q/edit#heading=h.trwvf85zn0se

  await logOutput(`Got headerchain with longest chain of length ${headerChain.getLongestChain().length}`);
}

async function validateCheckpoints(checkpoints) {
  if (checkpoints.every(cp => headerChain.getLongestChain().map(h => h.hash).includes(cp))) {
    await logOutput(`Checkpoints valid on headerChain ${headerChain.getLongestChain().length}`);
  } else {
    await logOutput('INVALID CHECKPOINT! please query more headers from other dapi nodes');
  }
}

async function BuildHeaderChain() {
  await getValidatedHeaderchain();

  // select 2 random from chain, in production this will be hardcoded
  const checkpoints =
    headerChain.getLongestChain()
      .map(h => h.hash)
      .sort(() => 0.5 - Math.random()) // 1 liner (sub optimal) shuffle hack
      .slice(0, 2);

  await validateCheckpoints(checkpoints);

  logOutput('Build HeaderChain complete');
}

// ==== Build HeaderChain

async function start() {
  await init(); // Client Initial state
  await BuildHeaderChain();
}

start();
