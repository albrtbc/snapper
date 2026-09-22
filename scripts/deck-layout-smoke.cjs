const { app, BrowserWindow } = require('electron'),
  fs = require('node:fs'),
  path = require('node:path');
const profile = path.resolve('.cache/deck-layout-smoke');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(
  path.join(profile, 'settings.json'),
  JSON.stringify({ scale: 1, layoutVersion: 2, positions: {} }),
);
app.setPath('userData', profile);
process.argv.push('--demo');
const source = process.argv.includes('--packaged-layout')
  ? '../dist/linux-unpacked/resources/app.asar/src'
  : '../src';
require('../test/helpers/ui-fixtures.cjs').installUiFixtures(path.resolve(__dirname, source));
const demo = require(source + '/demo.cjs'),
  original = demo.demoState,
  { Tracker } = require(source + '/core/tracker.cjs');
demo.demoState = () => {
  const state = original(),
    cards = state.match.cards.map((c) => ({ ...c }));
  cards.find((c) => c.cardId === 'Venom').cost = null;
  cards.find((c) => c.cardId === 'Blade').cost = 0;
  cards.find((c) => c.cardId === 'LadySif').status = 'destroyed';
  cards.find((c) => c.cardId === 'Apocalypse').status = 'banished';
  cards.push({
    entityId: 900,
    cardId: 'Rock',
    name: 'Rock',
    status: 'played',
    side: 'opponent',
    origin: 'generated',
    originKnown: true,
    cost: 1,
    power: 0,
  });
  cards.push({
    entityId: 901,
    cardId: 'Vibranium',
    name: 'Vibranium',
    status: 'banished',
    side: 'opponent',
    origin: 'generated',
    originKnown: true,
    cost: 1,
    power: 4,
  });
  cards.push({
    entityId: 902,
    cardId: 'Rock',
    name: 'Rock',
    status: 'hand',
    side: 'own',
    origin: 'generated',
    originKnown: true,
    cost: 1,
    power: 0,
  });
  cards.push({
    entityId: 903,
    cardId: 'SpiderHam',
    name: 'Spider-Ham',
    status: 'played',
    side: 'own',
    origin: 'opponent',
    originKnown: true,
    cost: 1,
    power: 1,
  });
  state.match = new Tracker().update({ ...state.match, cards });
  state.match.history = [
    {
      id: 'rock',
      name: 'Rock',
      cardId: 'Rock',
      side: 'opponent',
      origin: 'generated',
      from: 'deck',
      to: 'played',
      turn: 1,
    },
  ];
  return state;
};
require(source + '/services/card-info.cjs').CardInfo.prototype.get = async () => {
  await new Promise((r) => setTimeout(r, 100));
  return { baseCost: 3, text: 'Test ability.', language: 'en' };
};
require(source + '/main.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await app.whenReady();
  await wait(2500);
  const panels = BrowserWindow.getAllWindows(),
    own = panels.find((w) => w.webContents.getURL().includes('side=own')),
    opponent = panels.find((w) => w !== own);
  for (const win of panels) {
    win.setFocusable(false);
    const rows = await win.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('#cards .card-row')).map(node=>{const card=rowCards.get(node);return {id:card.cardId,cost:Number.isFinite(card.cost)?card.cost:baseCosts.get(card.cardId)};})`,
    );
    if (rows.some((r, i) => !Number.isFinite(r.cost) || (i && r.cost < rows[i - 1].cost)))
      throw Error('Cards not sorted: ' + JSON.stringify(rows));
  }
  const result = await opponent.webContents.executeJavaScript(`(()=>{
  const headers=Array.from(document.querySelectorAll('#piles summary')).map(n=>({text:n.textContent,y:n.getBoundingClientRect().y,overflow:n.scrollWidth>n.clientWidth+1}));
  return {headers,generated:document.querySelectorAll('[data-card-id="Rock"],[data-card-id="Vibranium"]').length,historyHidden:document.querySelector('#history-section').hidden,first:document.querySelector('#cards .card-row').dataset.cardId};
 })()`);
  if (
    result.generated ||
    !result.historyHidden ||
    result.first !== 'Blade' ||
    result.headers.length !== 3 ||
    result.headers.some((h) => h.y !== result.headers[0].y || h.overflow)
  )
    throw Error(JSON.stringify(result));
  if (
    !(await own.webContents.executeJavaScript(
      '!!document.querySelector("#extra [data-card-id=Rock]")',
    ))
  )
    throw Error('Own generated cards were hidden');
  if (
    !(await own.webContents.executeJavaScript(
      '!!document.querySelector("#extra [data-card-id=SpiderHam]")',
    )) ||
    !(await opponent.webContents.executeJavaScript(
      '!!document.querySelector("#cards [data-card-id=SpiderHam]")',
    ))
  )
    throw Error('Stolen enemy card must appear in both panels');
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync(
    'artifacts/deck-layout-opponent.png',
    (await opponent.webContents.capturePage()).toPNG(),
  );
  await own.webContents.executeJavaScript('window.snapper.openSettings()');
  await wait(250);
  const settings = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('settings.html'),
  );
  await settings.webContents.executeJavaScript('window.snapper.saveSettings({compact:true})');
  await wait(250);
  const columns = await opponent.webContents.executeJavaScript(
    'getComputedStyle(document.querySelector(".pile .card-list")).gridTemplateColumns.split(" ").length',
  );
  if (columns !== 2) throw Error('Compact mode shrank pile cards into five columns');
  console.log({
    pilesShareRow: true,
    opponentGeneratedCardsHidden: true,
    ownAddedCardsPreserved: true,
    stolenEnemyCardInBothPanels: true,
    costAscending: true,
    zeroCostFirst: true,
    unseenBaseCostSorted: true,
    compactPileColumns: columns,
  });
  app.quit();
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
