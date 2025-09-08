import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// Configuración
const OUTPUT_DIR = path.resolve(process.cwd(), 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'projects_test.json');

// URL del perfil que quieres extraer (cámbiala por la que quieras)
const PROFILE_URL = 'https://www.upwork.com/freelancers/tutigelormini';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureOutput() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function maybeWaitForHumanCheck(page) {
  try {
    const found = await page.locator('text=Verifying You Are Human,Verifying you are human').first().isVisible({ timeout: 2000 }).catch(() => false);
    if (found) {
      console.log('Human verification detected. Please complete the verification in the opened browser...');
      await page.waitForFunction(() => !document.body.innerText.match(/Verifying you are human/i), { timeout: 10 * 60 * 1000 });
      console.log('Human verification cleared. Continuing...');
    }
  } catch {}
}

async function gotoWithPacing(page, url) {
  console.log(`Navegando a: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await maybeWaitForHumanCheck(page);
  await sleep(3000 + Math.floor(Math.random() * 2000));
}

async function extractProfile(page, url) {
  console.log('Extrayendo datos del perfil...');
  
  // Verificar que es una URL válida de perfil de Upwork
  if (!/^https?:\/\/www\.upwork\.com\/freelancers\/(~[A-Za-z0-9]+|[A-Za-z0-9]+)/.test(url)) {
    console.error('❌ URL inválida. Debe ser un perfil de Upwork válido.');
    return null;
  }

  await gotoWithPacing(page, url);
  
  // Esperar a que cargue el contenido principal
  try { 
    await page.waitForSelector('main', { timeout: 20000 }); 
    console.log('✅ Contenido principal cargado');
  } catch {
    console.log('⚠️ No se encontró el contenido principal, continuando...');
  }
  
  await sleep(2000);

  // Función auxiliar para extraer texto de un selector
  const getText = async (selectors) => {
    for (const selector of selectors) {
      try {
        const element = await page.locator(selector).first();
        if (await element.count() > 0) {
          const text = (await element.textContent())?.trim();
          if (text) return text;
        }
      } catch {}
    }
    return null;
  };

  // Función auxiliar para extraer múltiples textos (como habilidades)
  const getTexts = async (selector) => {
    try {
      const elements = await page.locator(selector);
      const count = await elements.count();
      const texts = [];
      for (let i = 0; i < count; i++) {
        const text = (await elements.nth(i).textContent())?.trim();
        if (text) texts.push(text);
      }
      return texts;
    } catch {
      return [];
    }
  };

  // Extraer información del perfil
  const profile = {
    url: url,
    name: await getText([
      'main h1', 
      '[data-test="profile-title"]', 
      '[data-qa="freelancer-name"]', 
      'h1'
    ]),
    headline: await getText([
      '[data-test="title"]', 
      '[data-test="profile-overview-title"]', 
      '[data-qa="freelancer-title"]', 
      'main h2'
    ]),
    rate: await getText([
      '[data-test="rate"]', 
      '[data-qa="rate"]', 
      'text=/\$\\s*\\d[\\d,]*(?:\\.\\d+)?\\s*\\/\\s*hr/i'
    ]),
    earnings: await getText([
      'text=/Total (earned|earnings)/i', 
      '[data-test="earnings"]', 
      '[data-qa="earnings"]'
    ]),
    jobSuccess: await getText([
      'text=/Job Success/i', 
      '[data-test="job-success-score"]', 
      '[data-qa="jss"]'
    ]),
    location: await getText([
      '[data-test="location"]', 
      '[data-qa="location"]'
    ]),
    skills: await getTexts('[data-test="skill-list"] li, [data-qa="skill"]'),
    scrapedAt: new Date().toISOString()
  };

  // Intentar extraer información adicional del texto de la página
  try {
    const mainText = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    
    // Buscar tarifa si no se encontró
    if (!profile.rate) {
      const rateMatch = mainText.match(/\$\s*([\d,]+(?:\.\d+)?)\s*\/\s*hr/i);
      if (rateMatch) profile.rate = `$${rateMatch[1]}/hr`;
    }
    
    // Buscar ganancias si no se encontró
    if (!profile.earnings) {
      const earningsMatch = mainText.match(/Total\s*(?:earned|earnings)[^\d]*\$?\s*([\d.,]+\+?\s*[kKmM]?)/i);
      if (earningsMatch) profile.earnings = earningsMatch[0].trim();
    }
    
    // Buscar Job Success Score si no se encontró
    if (!profile.jobSuccess) {
      const jssMatch = mainText.match(/Job\s*Success\s*(\d{1,3})%/i);
      if (jssMatch) profile.jobSuccess = `${jssMatch[1]}%`;
    }
  } catch (error) {
    console.log('⚠️ Error al extraer texto adicional:', error.message);
  }

  return profile;
}

async function main() {
  console.log('🚀 Iniciando scraper de perfil individual...');
  
  // Verificar que se proporcionó una URL
  if (PROFILE_URL === 'https://www.upwork.com/freelancers/~TU_URL_AQUI') {
    console.error('❌ Por favor, cambia la variable PROFILE_URL por la URL real del perfil que quieres extraer.');
    console.log('📝 Ejemplo: https://www.upwork.com/freelancers/~usuario123');
    return;
  }

  await ensureOutput();
  
  // Crear directorio para datos del navegador
  const persistentDir = path.resolve(process.cwd(), 'chrome-user-data');
  if (!fs.existsSync(persistentDir)) fs.mkdirSync(persistentDir, { recursive: true });
  
  // Abrir navegador
  console.log('🌐 Abriendo navegador...');
  const context = await chromium.launchPersistentContext(persistentDir, {
    headless: false, // Mostrar navegador
    channel: 'chrome',
    viewport: { width: 1360, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--lang=en-US']
  });
  
  const page = await context.newPage();

  try {
    // Extraer datos del perfil
    const profileData = await extractProfile(page, PROFILE_URL);
    
    if (profileData) {
      // Guardar en archivo JSON
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(profileData, null, 2));
      
      console.log('✅ ¡Perfil extraído exitosamente!');
      console.log('📊 Datos extraídos:');
      console.log(`   👤 Nombre: ${profileData.name || 'No encontrado'}`);
      console.log(`   💼 Título: ${profileData.headline || 'No encontrado'}`);
      console.log(`   💰 Tarifa: ${profileData.rate || 'No encontrada'}`);
      console.log(`   💵 Ganancias: ${profileData.earnings || 'No encontradas'}`);
      console.log(`   ⭐ Job Success: ${profileData.jobSuccess || 'No encontrado'}`);
      console.log(`   📍 Ubicación: ${profileData.location || 'No encontrada'}`);
      console.log(`   🛠️ Habilidades: ${profileData.skills.length} encontradas`);
      console.log(`   📁 Guardado en: ${OUTPUT_FILE}`);
    } else {
      console.error('❌ No se pudo extraer el perfil');
    }
    
  } catch (error) {
    console.error('❌ Error durante la extracción:', error.message);
  } finally {
    // Cerrar navegador
    await context.close();
    console.log('🔒 Navegador cerrado');
  }
}

// Ejecutar el script
main().catch((error) => {
  console.error('💥 Error fatal:', error);
  process.exit(1);
});
