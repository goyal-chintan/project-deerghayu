import * as ifct2017 from '@nodef/ifct2017';

async function test() {
  await ifct2017.loadCodes();
  await ifct2017.loadCompositions();
  await ifct2017.loadGroups();

  console.log("codes('ragi'):", ifct2017.codes('ragi'));
  console.log("compositions('ragi'):", ifct2017.compositions('ragi'));
  console.log("groups('ragi'):", ifct2017.groups('ragi'));

  // Let's inspect the first few keys of ifct2017.codes
  console.log("codes corpus type:", typeof ifct2017.codes);
  // JSR packages usually have .corpus or .index or we can inspect properties
  console.log("codes keys:", Object.keys(ifct2017.codes));
  console.log("compositions keys:", Object.keys(ifct2017.compositions));
}

test().catch(console.error);
