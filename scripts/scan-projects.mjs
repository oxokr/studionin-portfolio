/**
 * scan-projects.mjs
 * 드롭박스 project/, T2/, T3/ 폴더를 스캔하여 프로젝트 인벤토리 JSON 생성
 *
 * 사용법: node scripts/scan-projects.mjs
 * 출력: data/project-inventory.json
 */

import fs from 'fs';
import path from 'path';

const DROPBOX_ROOT =
  '/Users/oxo/Library/CloudStorage/Dropbox-studionin/studionin';

const SOURCES = [
  { name: 'T1', path: path.join(DROPBOX_ROOT, 'project') },
  { name: 'T2', path: path.join(DROPBOX_ROOT, '..', 'T2') },
  { name: 'T3', path: path.join(DROPBOX_ROOT, '..', 'T3') },
];

// 내부/비프로젝트 폴더 제외
const SKIP_ORGS = new Set([
  'photo',
  'nin',
  'diff',
  '테스트',
]);

// 작업 파일 폴더 (산출물이 아닌 것)
const WORK_FOLDERS = new Set([
  '자료', '소스', '레퍼런스', '서류', '시안', '에스키스', '최종',
  'mockup', 'Mockup', '작업파일', '인쇄', '링크', '내보내기',
  '목업소스', 'Resources', 'Sketch', 'Capture', 'Output',
  'Selects', 'Trash',
]);

// 산출물 키워드 → 타입 태그 매핑
const TYPE_KEYWORDS = {
  exhibition: ['포스터', '리플렛', '리플릿', '초청장', '사인물', '전시장사인물',
    '외부사인물', '그래픽사인물', '현수막', '배너', '명제표', '엽서',
    '전단', '팸플릿', '팜플렛', 'Print'],
  editorial: ['도록', '소책자', '프로그램북', '시즌북', '브로슈어', '자료집',
    '학술총서', '매거진'],
  identity: ['bi', 'BI', '로고', '아이덴티티'],
  space: ['공간디자인', '공간그래픽', '사이니지', '스케치업', '가구',
    '카페트', '픽토그램', '피난안내도'],
  branding: ['패키지', '브랜드북', '홈페이지', '메뉴', '키오스크'],
};

// 기관 → 섹터 매핑
const SECTOR_MAP = {
  museum: ['미술관', '박물관', '갤러리', '아트센터', '이응노'],
  'performing-arts': ['예술의전당', '국악단', '문화재단', '나래관'],
  public: ['시청', '구청', '도청', '기록원', '기술전략', '기초과학',
    '에너지기술', '연구재단', '화학연구', '디자인진흥', 'MBC',
    '선사박물관', '도서관', '논산', '충청', '국가', '문화체육',
    '해외문화', 'UST'],
  commercial: ['Tpb', 'ordo', '애니토마토', '인테그라', '지원케미칼',
    '코리아투모로우', '에이트', '예스빌딩', '파인드블루', '포프',
    '더그룹', '롯데', '스물하나', '금강아트', '똑똑도독', '육공소',
    'bok', '버찌책방', '한국화학'],
  artist: ['작가', '교수', '이종우', '임동식'],
  'self-initiated': ['자체프로젝트', '얼룩'],
};

function guessSector(orgName) {
  const normalized = orgName.normalize('NFC');
  for (const [sector, keywords] of Object.entries(SECTOR_MAP)) {
    for (const kw of keywords) {
      if (normalized.includes(kw.normalize('NFC'))) return sector;
    }
  }
  return 'commercial'; // 기본값
}

function guessYear(projectName) {
  // 앞쪽 4자리 숫자
  const leadMatch = projectName.match(/^(\d{4})/);
  if (leadMatch) return parseInt(leadMatch[1]);
  // 어딘가에 있는 4자리 숫자
  const anyMatch = projectName.match(/(\d{4})/);
  if (anyMatch) {
    const y = parseInt(anyMatch[1]);
    if (y >= 2018 && y <= 2030) return y;
  }
  return null;
}

function guessTypes(subfolders) {
  const types = new Set();
  for (const sub of subfolders) {
    const normalized = sub.normalize('NFC');
    for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
      for (const kw of keywords) {
        if (normalized.includes(kw.normalize('NFC'))) {
          types.add(type);
          break;
        }
      }
    }
  }
  return types.size > 0 ? [...types] : ['exhibition']; // 기본값
}

function toSlug(orgName, projectName) {
  // 간단한 한글 → 영문 변환은 하지 않음 — 수동 확인 필요
  // 영문+숫자만 추출하여 slug 생성
  const combined = `${orgName}-${projectName}`;
  const slug = combined
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `project-${Date.now()}`;
}

function scanSource(source) {
  const organizations = [];
  const srcPath = path.resolve(source.path);

  if (!fs.existsSync(srcPath)) {
    console.warn(`  ⚠ Path not found: ${srcPath}`);
    return organizations;
  }

  const orgDirs = fs
    .readdirSync(srcPath, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .filter((d) => !SKIP_ORGS.has(d.name.normalize('NFC')));

  for (const orgDir of orgDirs) {
    const orgPath = path.join(srcPath, orgDir.name);
    const projects = [];

    const projDirs = fs
      .readdirSync(orgPath, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'));

    for (const projDir of projDirs) {
      const projPath = path.join(orgPath, projDir.name);

      // 하위 폴더 수집
      const subfolders = [];
      try {
        const subs = fs
          .readdirSync(projPath, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'));
        for (const s of subs) subfolders.push(s.name);
      } catch { /* skip */ }

      // 매뉴얼 PDF 수
      let pdfCount = 0;
      const manualPath = path.join(projPath, '매뉴얼');
      const manualPath2 = path.join(projPath, 'Manual');
      for (const mp of [manualPath, manualPath2]) {
        if (fs.existsSync(mp)) {
          try {
            pdfCount += fs
              .readdirSync(mp)
              .filter((f) => f.endsWith('.pdf')).length;
          } catch { /* skip */ }
        }
      }

      // 산출물 폴더 (작업 폴더 제외)
      const deliverableFolders = subfolders.filter(
        (s) => !WORK_FOLDERS.has(s) && !s.startsWith('.')
      );

      projects.push({
        name: projDir.name,
        yearGuess: guessYear(projDir.name),
        typesGuess: guessTypes(subfolders),
        hasPdfs: pdfCount > 0,
        pdfCount,
        deliverableFolders,
        subfolderCount: subfolders.length,
        suggestedSlug: toSlug(orgDir.name, projDir.name),
      });
    }

    if (projects.length > 0) {
      organizations.push({
        name: orgDir.name,
        sectorGuess: guessSector(orgDir.name),
        source: source.name,
        projectCount: projects.length,
        projects,
      });
    }
  }

  return organizations;
}

// Main
console.log('🔍 Scanning project folders...\n');

const allOrganizations = [];
for (const source of SOURCES) {
  console.log(`📁 Scanning ${source.name}: ${source.path}`);
  const orgs = scanSource(source);
  allOrganizations.push(...orgs);
  console.log(`   Found ${orgs.length} organizations\n`);
}

const totalProjects = allOrganizations.reduce(
  (sum, org) => sum + org.projectCount,
  0
);

const inventory = {
  scannedAt: new Date().toISOString(),
  stats: {
    totalOrganizations: allOrganizations.length,
    totalProjects,
    bySource: {
      T1: allOrganizations
        .filter((o) => o.source === 'T1')
        .reduce((s, o) => s + o.projectCount, 0),
      T2: allOrganizations
        .filter((o) => o.source === 'T2')
        .reduce((s, o) => s + o.projectCount, 0),
      T3: allOrganizations
        .filter((o) => o.source === 'T3')
        .reduce((s, o) => s + o.projectCount, 0),
    },
  },
  organizations: allOrganizations,
};

const outDir = path.resolve('data');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const outPath = path.join(outDir, 'project-inventory.json');
fs.writeFileSync(outPath, JSON.stringify(inventory, null, 2), 'utf-8');

console.log(`✅ Inventory saved: ${outPath}`);
console.log(`   ${inventory.stats.totalOrganizations} organizations`);
console.log(`   ${inventory.stats.totalProjects} projects`);
console.log(
  `   T1: ${inventory.stats.bySource.T1} / T2: ${inventory.stats.bySource.T2} / T3: ${inventory.stats.bySource.T3}`
);
