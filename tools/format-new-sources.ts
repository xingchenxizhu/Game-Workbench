/** Format the newly introduced TypeScript modules using the installed compiler. */
import ts from 'typescript';
import {readFile,writeFile} from 'node:fs/promises';
const files=process.argv.slice(2);
if(!files.length)throw new Error('Supply TypeScript source paths');
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});
for(const path of files){
 const source=ts.createSourceFile(path,await readFile(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 if((source as any).parseDiagnostics.length)throw new Error('Parse error in '+path);
 await writeFile(path,printer.printFile(source),'utf8');
}
console.log('Formatted '+files.length+' TypeScript modules.');
