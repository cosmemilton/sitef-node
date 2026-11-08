import {readFile,writeFile,mkdir} from 'node:fs/promises';
for(const name of ['fields','functions']){
  const content=await readFile(new URL(`../protocol/${name}.json`,import.meta.url),'utf8');
  await mkdir(new URL('../packages/core/src/data/',import.meta.url),{recursive:true});
  await writeFile(new URL(`../packages/core/src/data/${name}.json`,import.meta.url),content);
}

const { generateFieldIds } = await import('./generate-field-ids.mjs');
await generateFieldIds();
