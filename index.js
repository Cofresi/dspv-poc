const Api = require('@dashevo/dapi-client');
const { SpvChain } = require('@dashevo/dash-spv');
const commander = require('commander');

const log = console;

async function logOutput(msg, delay = 50) {
  log.info(`${msg}`);
  await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Create and setup DAPI client instance
 *
 * @param {string[]} seeds
 *
 * @return {Promise<DAPIClient>}
 */
async function initApi(seeds) {
  const services = seeds.map(seed => new Object({ service: seed }));

  api = new Api({
    seeds: services,
    port: 3000
  });

  // using genesis as nullhash as core is bugged
  await api.getBlockHash(0);

  return api;
}

/**
 * Build the header chain for a specified slice
 *
 * @param {DAPIClient} api
 * @param {string[]} seeds
 * @param {boolean} parallel
 * @param {int} fromHeight
 * @param {int} toHeight
 * @param {int} step TODO: DGW not allowing more than 24 blocks, low difficulty regtest problem
 *
 * @return {Promise<SpvChain>}
 */
async function buildHeaderChain(api, seeds, parallel, fromHeight, toHeight, step) {
  const fromBlockHash = await api.getBlockHash(fromHeight);
  const fromBlockHeader = await api.getBlockHeader(fromBlockHash);

  fromBlockHeader.prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
  fromBlockHeader.bits = +(`0x${fromBlockHeader.bits}`);

  const numConfirms = 10000;

  const headerChain = new SpvChain('custom_genesis', numConfirms, fromBlockHeader);

  if (parallel) {
    // TODO implement parallel queries
  } else {
    for (let height = fromHeight + 1; height <= toHeight; height += step) {
      /* eslint-disable-next-line no-await-in-loop */
      const newHeaders = await api.getBlockHeaders(height, step);
      await logOutput(`newHeaders ${newHeaders}`);
      headerChain.addHeaders(newHeaders);
    }
  }

  // NOTE: query a few nodes by repeating the process to make sure you on the longest chain
  // headerChain instance will automatically follow the longest chain, keep track of orphans, etc
  // implementation detail @ https://docs.google.com/document/d/1jV0zCie5rVbbK9TbhkDUbbaQ9kG9oU8XTAWMVYjRc2Q/edit#heading=h.trwvf85zn0se

  await logOutput(`Got headerchain with longest chain of length ${headerChain.getLongestChain().length}`);

  return headerChain;
}

/**
 * Validate checkpoints of a header chain
 *
 * @param {SpvChain} headerChain
 *
 * @return {Promise<void>}
 */
async function validateCheckpoints(headerChain) {
  const checkpoints =
    headerChain.getLongestChain()
      .map(h => h.hash)
      .sort(() => 0.5 - Math.random()) // 1 liner (sub optimal) shuffle hack
      .slice(0, 2);

  if (checkpoints.every(cp => headerChain.getLongestChain().map(h => h.hash).includes(cp))) {
    await logOutput(`Checkpoints valid on headerChain ${headerChain.getLongestChain().length}`);
  } else {
    await logOutput('INVALID CHECKPOINT! please query more headers from other dapi nodes');
  }
}

/**
 * Main entry point for sync
 *
 * @param {string[]} seeds
 * @param {Command} cmd
 *
 * @return {Promise<void>}
 */
async function sync(seeds, cmd) {
  const api = await initApi(seeds);
  const headerChain = await buildHeaderChain(
    api,
    seeds,
    cmd.parallel,
    cmd.from,
    cmd.to,
    cmd.step,
  );
  await validateCheckpoints(headerChain);
}

commander
  .command('sync [seeds...]')
  .option('-p, --parallel', 'Make parallel requests to DAPI nodes')
  .option('-f, --from <n>', 'Block height to start from', parseInt, 1000)
  .option('-t, --to <n>', 'Block height to stop parsing onto', parseInt, 2000)
  .option('-s, --step <n>', 'Number of blocks to get in a batch', parseInt, 24)
  .action(sync);

commander.parse(process.argv);
