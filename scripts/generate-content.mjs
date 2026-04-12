/**
 * generate-content.mjs
 * 인벤토리 JSON에서 포트폴리오 후보 프로젝트의 .md 스캐폴딩 파일 생성
 *
 * 사용법: node scripts/generate-content.mjs
 *   --all         모든 프로젝트 생성 (기본: 매뉴얼 PDF 있는 것만)
 *   --force       기존 파일 덮어쓰기
 *   --dry-run     파일 생성 없이 미리보기
 *
 * 출력: src/content/projects/[slug].md
 */

import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const ALL_MODE = args.includes('--all');
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');

const INVENTORY_PATH = path.resolve('data/project-inventory.json');
const CONTENT_DIR = path.resolve('src/content/projects');

if (!fs.existsSync(INVENTORY_PATH)) {
  console.error('❌ Inventory not found. Run scan-projects.mjs first.');
  process.exit(1);
}

const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf-8'));

// 포트폴리오 후보 필터링
function isPortfolioCandidate(org, project) {
  // 매뉴얼 PDF가 있으면 완성된 프로젝트로 간주
  if (project.hasPdfs) return true;
  // 산출물 폴더가 3개 이상이면 유의미한 프로젝트
  if (project.deliverableFolders.length >= 3) return true;
  // --all 모드면 모두 포함
  if (ALL_MODE) return true;
  return false;
}

// 슬러그 개선: 중복 방지 + 간결화
const usedSlugs = new Set();

function makeUniqueSlug(orgName, projectName, source) {
  // 영문+숫자 추출
  let base = `${orgName}-${projectName}`
    .normalize('NFC')
    .replace(/[^\w가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  // 너무 긴 슬러그 줄이기
  if (base.length > 60) {
    base = base.substring(0, 60).replace(/-[^-]*$/, '');
  }

  let slug = base;
  let counter = 2;
  while (usedSlugs.has(slug)) {
    slug = `${base}-${counter}`;
    counter++;
  }
  usedSlugs.add(slug);
  return slug;
}

function generateFrontmatter(org, project) {
  const slug = makeUniqueSlug(org.name, project.name, org.source);
  const year = project.yearGuess || 2023;
  const types = project.typesGuess || ['exhibition'];

  const deliverables = project.deliverableFolders
    .filter(f => !['매뉴얼', 'Manual', 'Digital', 'Space', 'mockup', 'Mockup',
      '어플리케이션', '목업', '웹', 'SNS', '촬영fin', '편집'].includes(f.normalize('NFC')))
    .slice(0, 10)
    .map(f => `  - item: '${f.normalize('NFC')}'`);

  const lines = [
    '---',
    `title: '${project.name.normalize('NFC')}'`,
    `titleEn: ''`,
    `slug: '${slug}'`,
    `year: ${year}`,
    `organization: '${org.name.normalize('NFC')}'`,
    `organizationEn: ''`,
    `sector: '${org.sectorGuess}'`,
    `type:`,
    ...types.map(t => `  - '${t}'`),
    `heroLayout: 'content-width'`,
    `sortOrder: 50`,
    `collaboration: '${org.source === 'T3' ? 'collaboration' : 'solo'}'`,
    org.source === 'T3' ? `collaborator: '3팀 공동작업'` : null,
    `description: |`,
    `  [프로젝트 설명 작성]`,
    `featured: true`,
    `draft: true`,
  ].filter(Boolean);

  if (deliverables.length > 0) {
    lines.push(`deliverables:`);
    lines.push(...deliverables);
  }

  lines.push(
    `credits:`,
    `  design: 'studionin'`,
    `  client: '${org.name.normalize('NFC')}'`,
    `# source: ${org.source}/${org.name}/${project.name}`,
    '---',
    '',
  );

  return { slug, content: lines.join('\n') };
}

// Main
console.log(`📝 Generating content scaffolds...\n`);
console.log(`   Mode: ${ALL_MODE ? 'ALL projects' : 'Only projects with manuals/deliverables'}`);
console.log(`   Force: ${FORCE}`);
console.log(`   Dry run: ${DRY_RUN}\n`);

if (!fs.existsSync(CONTENT_DIR)) {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
}

let created = 0;
let skipped = 0;
let alreadyExists = 0;

for (const org of inventory.organizations) {
  for (const project of org.projects) {
    if (!isPortfolioCandidate(org, project)) {
      skipped++;
      continue;
    }

    const { slug, content } = generateFrontmatter(org, project);
    const filePath = path.join(CONTENT_DIR, `${slug}.md`);

    if (fs.existsSync(filePath) && !FORCE) {
      alreadyExists++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  📄 [DRY] ${slug}.md  ← ${org.source}/${org.name}/${project.name}`);
    } else {
      fs.writeFileSync(filePath, content, 'utf-8');
    }
    created++;
  }
}

console.log(`\n✅ Done!`);
console.log(`   Created: ${created}`);
console.log(`   Already exists: ${alreadyExists}`);
console.log(`   Skipped (not candidate): ${skipped}`);
console.log(`   Total in inventory: ${inventory.stats.totalProjects}`);
