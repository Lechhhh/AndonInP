        const Exporter = (function () {
            const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
            const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
            const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
            const col = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
            const cell = (ref, v, bold) => { const s = bold ? ' s="1"' : ''; return (typeof v === 'number' && isFinite(v)) ? `<c r="${ref}"${s}><v>${v}</v></c>` : `<c r="${ref}"${s} t="inlineStr"><is><t>${esc(v)}</t></is></c>`; };
            const row = (r, cells, bold) => `<row r="${r}">${cells.map((v, i) => cell(col(i + 1) + r, v, bold)).join('')}</row>`;
            const sheet = (headers, data) => { let b = row(1, headers, true); data.forEach((rw, i) => b += row(i + 2, rw, false)); return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${b}</sheetData></worksheet>`; };
            const u16 = (n) => new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF]);
            const u32 = (n) => new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]);
            const cat = (...a) => { let L = a.reduce((s, x) => s + x.length, 0), r = new Uint8Array(L), o = 0; for (const x of a) { r.set(x, o); o += x.length; } return r; };
            function zip(files) {
                const enc = new TextEncoder(); const parts = []; const cen = []; let off = 0;
                const push = (u) => { parts.push(u); off += u.length; };
                for (const f of files) {
                    const nb = enc.encode(f.name), data = f.data, crc = crc32(data), at = off;
                    push(cat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nb.length), u16(0)));
                    push(nb); push(data);
                    cen.push({ nb, crc, size: data.length, at });
                }
                const cdStart = off;
                for (const c of cen) { push(cat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(c.crc), u32(c.size), u32(c.size), u16(c.nb.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.at))); push(c.nb); }
                push(cat(u32(0x06054b50), u16(0), u16(0), u16(cen.length), u16(cen.length), u32(off - cdStart), u32(cdStart), u16(0)));
                let L = parts.reduce((s, x) => s + x.length, 0), out = new Uint8Array(L), o = 0; for (const x of parts) { out.set(x, o); o += x.length; } return out;
            }
            const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
            const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
            const WB = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Czasy wykonania" sheetId="1" r:id="rId1"/></sheets></workbook>`;
            const WBR = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
            const STY = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
            function makeXlsx(headers, data) {
                const enc = new TextEncoder();
                return zip([
                    { name: '[Content_Types].xml', data: enc.encode(CT) },
                    { name: '_rels/.rels', data: enc.encode(RELS) },
                    { name: 'xl/workbook.xml', data: enc.encode(WB) },
                    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(WBR) },
                    { name: 'xl/styles.xml', data: enc.encode(STY) },
                    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet(headers, data)) },
                ]);
            }
            function downloadCycles(cycleTimes) {
                const headers = ['Lp.', 'Stanowisko', 'Takt', 'Czas wykonania', 'Czas [s]', 'Godzina'];
                const ordered = (cycleTimes || []).slice().reverse(); // chronologicznie: od najstarszego
                const secs = (m) => { const x = /(\d+)m\s*(\d+)s/.exec(m || ''); return x ? (+x[1] * 60 + +x[2]) : ''; };
                const data = ordered.map((c, i) => [i + 1, c.s, c.t, c.m, secs(c.m), c.ts]);
                const bytes = makeXlsx(headers, data);
                const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const d = new Date(), p = (n) => String(n).padStart(2, '0');
                const fname = `andon_czasy_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.xlsx`;
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = fname;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1500);
                return { count: data.length, fname };
            }
            function downloadTable(headers,data,fname){const bytes=makeXlsx(headers,data);const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=fname;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);return {count:data.length,fname};}
            return { makeXlsx, downloadCycles, downloadTable };
        })();

