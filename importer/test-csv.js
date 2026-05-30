import fs from 'fs';

function inspectCsv(filePath) {
  console.log(`\n--- Inspecting ${filePath} ---`);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  console.log("Headers:", lines[0]);
  console.log("Row 1  :", lines[1]);
  console.log("Row 2  :", lines[2]);
  console.log("Total Rows:", lines.length);
}

inspectCsv('node_modules/@nodef/ifct2017/compositions/index.csv');
inspectCsv('node_modules/@nodef/ifct2017/codes/index.csv');
inspectCsv('node_modules/@nodef/ifct2017/groups/index.csv');
inspectCsv('node_modules/@nodef/ifct2017/columns/index.csv');
