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
 * Retrieve headers for a slice and populate header chain
 *
 * @param {DAPIClient} api
 * @param {SpvChain} headerChain
 * @param {int} fromHeight
 * @param {int} toHeight
 * @param {int} step
 *
 * @returns {Promise<void>}
 */
async function populateHeaderChain(api, headerChain, fromHeight, toHeight, step) {
  const extraHeight = (toHeight - fromHeight) % step;

  for (let height = fromHeight; height < toHeight - extraHeight; height += step) {
    /* eslint-disable-next-line no-await-in-loop */
    const newHeaders = await api.getBlockHeaders(height, step);
    await logOutput(`newHeaders ${newHeaders}`);
    headerChain.addHeaders(newHeaders);
  }

  const extraHeaders = await api.getBlockHeaders(toHeight, extraHeight);
  headerChain.addHeaders(extraHeaders);
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
  // Start time to check method call time
  const hrStartTime = process.hrtime();

  const fromBlockHash = await api.getBlockHash(fromHeight);
  const fromBlockHeader = await api.getBlockHeader(fromBlockHash);

  fromBlockHeader.prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
  fromBlockHeader.bits = +(`0x${fromBlockHeader.bits}`);

  const numConfirms = 10000;

  const headerChain = new SpvChain('custom_genesis', numConfirms, fromBlockHeader);

  if (parallel) {
    /**
     * Naive worker-like implementation of a parallel calls
     *
     *    node1    node2     node3
     *   /    \   /    \   /       \
     *  |  |  |  |  |  |  |  |  |  |
     *  1  2  3  1  2  3  1  2  3  4
     * [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] - header chain
     *
     */
    const heightDiff = toHeight - fromHeight;
    const heightDelta = parseInt(heightDiff / seeds.length);
    const heightExtra = heightDiff % seeds.length;

    const promises = seeds.map(async (seed, index) => {
      const excludedSeeds = seeds.filter(s => s !== seed);

      // TODO pass excluded seeds to DAPI client request

      const localFromHeight = fromHeight + (heightDelta * index);
      let localToHeight = localFromHeight + heightDelta;

      // Ask last node a few extra headers
      if (index === seeds.length - 1) {
        localToHeight += heightExtra;
      }

      await populateHeaderChain(api, headerChain, localFromHeight, localToHeight, step);
    });

    await Promise.all(promises);
  } else {
    await populateHeaderChain(api, headerChain, fromHeight, toHeight, step);
  }

  // NOTE: query a few nodes by repeating the process to make sure you on the longest chain
  // headerChain instance will automatically follow the longest chain, keep track of orphans, etc
  // implementation detail @ https://docs.google.com/document/d/1jV0zCie5rVbbK9TbhkDUbbaQ9kG9oU8XTAWMVYjRc2Q/edit#heading=h.trwvf85zn0se

  await logOutput(`Got headerChain with longest chain of length ${headerChain.getLongestChain().length}`);

  const hrEndTime = process.hrtime(hrStartTime);

  await logOutput(`buildHeaderChain took ${hrEndTime[0]}s ${hrEndTime[1] / 1000000}ms`);

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
    await logOutput('INVALID CHECKPOINT! please query more headers from other DAPI nodes');
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
