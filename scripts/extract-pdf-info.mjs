/**
 * extract-pdf-info.mjs
 * pdftotext(macOS)로 매뉴얼 PDF에서 산출물 정보를 추출
 *
 * 사용법: node scripts/extract-pdf-info.mjs
 * 출력: data/pdf-extracts.json
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DROPBOX = '/Users/oxo/Library/CloudStorage/Dropbox-studionin';
const SOURCES = {
  T1: path.join(DROPBOX, 'studionin/project'),
  T2: path.join(DROPBOX, 'T2'),
  T3: path.join(DROPBOX, 'T3'),
};

const sel = JSON.parse(fs.readFileSync('data/project-selections.json', 'utf-8'));

function pickBestPdf(pdfFiles) {
  if (pdfFiles.length <= 1) return pdfFiles[0] || null;

  // 프로젝트 전체 매뉴얼 (가장 종합적인 것) 우선
  const mainManual = pdfFiles.find(f =>
    /매뉴얼[_\s]?v?\d/i.test(f) && !/사인물|배너|웹|버스|가로등|외부|명제표/i.test(f)
  );
  if (mainManual) {
    // 가장 높은 버전 찾기
    const versions = pdfFiles
      .filter(f => f.replace(/v?\d+(\.\d+)?/, '') === mainManual.replace(/v?\d+(\.\d+)?/, ''))
      .map(f => {
        const m = f.match(/v?(\d+(?:\.\d+)?)/);
        return { file: f, ver: m ? parseFloat(m[1]) : 0 };
      })
      .sort((a, b) => b.ver - a.ver);
    return versions[0]?.file || mainManual;
  }

  // 그냥 첫 번째
  return pdfFiles[0];
}

function extractText(pdfPath) {
  try {
    const text = execSync(
      `pdftotext -l 10 "${pdfPath}" -`,
      { maxBuffer: 5 * 1024 * 1024, timeout: 15000 }
    ).toString('utf-8');
    return text;
  } catch {
    return '';
  }
}

function parseDeliverables(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const deliverables = [];
  const seen = new Set();

  for (const line of lines) {
    // 사이즈 패턴: "000×000mm" 또는 "000x000"
    const sizeMatch = line.match(/(\d{2,5})\s*[×xX]\s*(\d{2,5})\s*(mm)?/);
    if (!sizeMatch) continue;
    if (line.length > 150) continue;

    // 사이즈 앞쪽 = 산출물 유형
    const idx = line.indexOf(sizeMatch[0]);
    let itemName = line.substring(0, idx).trim();

    // 뒤쪽 = 재질/수량
    let spec = line.substring(idx).trim();

    // 정리
    itemName = itemName.replace(/[,\s·]+$/, '').trim();

    if (!itemName || itemName.length < 2 || itemName.length > 25) continue;
    if (seen.has(itemName)) continue;

    seen.add(itemName);
    deliverables.push({ item: itemName, spec: spec.substring(0, 60) });
  }

  return deliverables;
}

// Main
console.log('📄 Extracting PDF info via pdftotext...\n');

const results = [];
let processed = 0, extracted = 0;

for (const s of sel) {
  const srcBase = SOURCES[s.source] || SOURCES.T1;
  const projPath = path.join(srcBase, s.orgName, s.projectName);

  const pdfFiles = [];
  for (const manDir of ['매뉴얼', 'Manual']) {
    const manPath = path.join(projPath, manDir);
    if (fs.existsSync(manPath)) {
      try {
        const files = fs.readdirSync(manPath)
          .filter(f => f.endsWith('.pdf'))
          .map(f => path.join(manPath, f));
        pdfFiles.push(...files);
      } catch {}
    }
  }

  if (pdfFiles.length === 0) continue;

  const bestPdf = pickBestPdf(pdfFiles.map(f => path.basename(f)));
  const pdfPath = pdfFiles.find(f => path.basename(f) === bestPdf);
  if (!pdfPath) continue;

  const text = extractText(pdfPath);
  const deliverables = parseDeliverables(text);

  results.push({
    org: s.orgName,
    project: s.projectName,
    pdf: path.basename(pdfPath),
    deliverables,
    textLength: text.length,
  });

  if (deliverables.length > 0) extracted++;
  processed++;

  if (processed % 30 === 0) console.log(`  ${processed} processed...`);
}

fs.writeFileSync('data/pdf-extracts.json', JSON.stringify(results, null, 2), 'utf-8');

console.log(`\n✅ 완료`);
console.log(`   PDF 처리: ${processed}개`);
console.log(`   산출물 추출: ${extracted}개`);

// .md 파일에 deliverables 추가
const contentDir = 'src/content/projects';
let updated = 0;

for (const r of results) {
  if (r.deliverables.length === 0) continue;

  const key = (r.org + '/' + r.project).normalize('NFC');
  const mdFiles = fs.readdirSync(contentDir).filter(f => f.endsWith('.md'));

  for (const mdFile of mdFiles) {
    const filePath = path.join(contentDir, mdFile);
    const content = fs.readFileSync(filePath, 'utf-8');
    const sourceMatch = content.match(/# source: (T[123])\/(.+?)\/(.+)/);

    if (!sourceMatch) continue;
    const mdKey = (sourceMatch[2] + '/' + sourceMatch[3]).normalize('NFC');
    if (mdKey !== key) continue;

    // deliverables가 아직 없는 경우만 추가
    if (content.includes('deliverables:')) break;

    const delYaml = r.deliverables.map(d => {
      let line = `  - item: '${d.item}'`;
      if (d.spec) line += `\n    spec: '${d.spec}'`;
      return line;
    }).join('\n');

    const newContent = content.replace(
      /^credits:/m,
      `deliverables:\n${delYaml}\ncredits:`
    );

    if (newContent !== content) {
      fs.writeFileSync(filePath, newContent, 'utf-8');
      updated++;
    }
    break;
  }
}

console.log(`   .md 업데이트: ${updated}개`);
