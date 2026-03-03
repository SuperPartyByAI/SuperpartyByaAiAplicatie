import fs from 'fs';

const URL = 'https://ilkphpidhuytucxlglqi.supabase.co/rest/v1/?apikey=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlsa3BocGlkaHV5dHVjeGxnbHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNDI1NTYsImV4cCI6MjA4NzkxODU1Nn0.vO95CLAgt9M1vUr4za9CNVHjuEmeeQWW-qCMnY4_UPE';

async function generateSchema() {
    try {
        const res = await fetch(URL);
        const schema = await res.json();
        
        let md = '# 🗄️ Supabase REST Schema (OpenAPI)\n\n';
        md += '> Documentație generată automat via OpenAPI REST din Supabase. Conține structura tabelelor publice și vizibile din perspectiva API-ului client.\n\n';
        
        const defs = schema.definitions || schema.components?.schemas;
        if (!defs) {
            console.error('Definitions not found in schema');
            return;
        }

        for (const [tableName, tableDef] of Object.entries(defs)) {
            md += `## Tabel: \`${tableName}\`\n\n`;
            if (tableDef.description) md += `*${tableDef.description}*\n\n`;
            
            md += '| Coloană | Tip Date | Format | Descriere |\n';
            md += '| ------- | -------- | ------ | --------- |\n';
            
            if (tableDef.properties) {
                for (const [colName, colDef] of Object.entries(tableDef.properties)) {
                    const desc = (colDef.description || '').replace(/\n/g, ' ');
                    const type = colDef.type || (colDef.$ref ? colDef.$ref.split('/').pop() : 'any');
                    md += `| \`${colName}\` | \`${type}\` | ${colDef.format || '-'} | ${desc} |\n`;
                }
            } else {
                md += '| (Fără coloane vizibile) | | | |\n';
            }
            md += '\n';
        }
        
        fs.writeFileSync('../SUPABASE_SCHEMA.md', md, 'utf8');
        console.log('Successfully generated SUPABASE_SCHEMA.md');
    } catch(err) {
        console.error('Fetch error:', err);
    }
}

generateSchema();
