import puppeteer from "puppeteer";
import fs from "fs";
import ProgressBar from "progress";

/**
 * Classe para fazer o gerenciamento de tabs disponiveis
 */
class TabPool {
  constructor() {
    this.resources = [];
  }

  async addResource(resource) {
    this.resources.push(resource);
  }

  async getResource() {
    while (this.resources.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.resources.shift();
  }

  async releaseResource(resource) {
    this.resources.push(resource);
  }
}

/**
 * Retorna o parametro default caso o selector não seja encontrado
 */
async function getSelector(element, selector, defaultValue, callback) {
  try {
    return await element.$eval(selector, callback);
  } catch {}

  return defaultValue;
}

/**
 * Extrai todos os anuncios
 */
async function extractAds(tab) {
  // Esperar pelo elemento com os anuncios carregar
  await tab.waitForSelector("ul#ad-list");

  // Pega todos os anuncios da pagina
  const sections = await tab.$$("ul#ad-list section");
  const ads = [];

  let lower_ad = {
    price: Number.MAX_VALUE,
    link: null,
  };

  let higher_ad = {
    price: Number.MIN_VALUE,
    link: null,
  };

  // Coleta todas as informações de cada anuncio
  for (const section of sections) {
    let price = await getSelector(section, "h3", null, (h3) => parseInt(h3.textContent.replace(/[^\d]/g, "")));
    let link = await section.$eval("a", (a) => a.href);

    if (price !== null) {
      if (price > higher_ad.price) {
        higher_ad = { price, link };
      }
      if (price < lower_ad.price) {
        lower_ad = { price, link };
      }
    }

    try {
      ads.push({
        name: await section.$eval("h2", (h2) => h2.textContent),
        price,
        link,
        region: await (await section.$("xpath///div[./p/@data-testid='ds-adcard-date']/p")).evaluate((p) => p.textContent),
        attrs: {
          rooms: await getSelector(section, "span[aria-label*='quarto']", null, (span) => parseInt(span.textContent)),
          sqr_meters: await getSelector(section, "span[aria-label*='metro']", null, (span) => parseInt(span.textContent)),
          bathrooms: await getSelector(section, "span[aria-label*='banheiro']", null, (span) => parseInt(span.textContent)),
          parking_lot: await getSelector(section, "span[aria-label*='garagem']", null, (span) => parseInt(span.textContent)),
        },
      });
    } catch {}
  }

  // Provavelmetne nenhum anuncio foi encontrado
  if (higher_ad.link === null) {
    lower_ad = null;
    higher_ad = null;
  }

  return {
    higher_ad,
    lower_ad,
    ads,
  };
}

/**
 * Redireciona para uma determinada pagina de uma região e extrai os anuncios
 */
async function getPageAds(tab, link, page_number) {
  try {
    await tab.goto(link + "?o=" + page_number, { waitUntil: "domcontentloaded" });

    return await extractAds(tab);
  } catch {
    return [];
  }
}

/**
 * Cria uma nova tab configurada
 */
async function createTab(browser) {
  const tab = await browser.newPage();
  tab.setViewport({
    width: 640,
    height: 480,
  });
  tab.setDefaultTimeout(180_000);
  return tab;
}

/**
 * Pega o numero maximo de paginas
 */
async function getRegionPageLimit(tab) {
  try {
    return await (
      await tab.$("xpath///div[@data-testid='paginationMobile']//p")
    ).evaluate((p) => {
      return parseInt(p.textContent.split("de ")[1]);
    });
  } catch {
    return 0;
  }
}

/**
 * Coleta todos os anuncios de uma região.
 */
export async function extractRegion(link, max_tabs = 10) {
  const browser = await puppeteer.launch({ headless: false });

  try {
    let tabPool = new TabPool();

    let tab = await createTab(browser);
    await tab.goto(link, { waitUntil: "domcontentloaded" });

    const region_pages_length = await getRegionPageLimit(tab);

    const bar = new ProgressBar(":bar :current/:total", { total: region_pages_length });

    await tabPool.addResource(tab);
    for (let i = 1; i < Math.min(region_pages_length, max_tabs); i++) {
      await tabPool.addResource(await createTab(browser));
    }

    let cachedPromises = [];

    // Loop para criar um Promise para coletar uma pagina individualmente
    // assim a coleta pode ser realizada de forma assincrona.
    for (let i = 1; i <= region_pages_length; i++) {
      cachedPromises.push(
        new Promise(async (resolve, reject) => {
          // Pega uma ABA disponivel da pool
          let page = await tabPool.getResource();

          // Coleta os anuncios da pagina
          const page_data = await getPageAds(page, link, i);

          // Devolve a ABA a piscina
          await tabPool.releaseResource(page);

          bar.tick();

          resolve(page_data);
        })
      );
    }

    // Espera a coleta de todas as paginas
    const all_pages_data = await Promise.all(cachedPromises);

    if (all_pages_data.length == 0) {
      throw "Nenhuma pagina de anuncio foi encontrada";
    }

    let { higher_ad, lower_ad, ads } = all_pages_data[0];

    // Junta todos os anuncios em um unico array
    // selecionar o maior e menor anuncio encontrado entre todas as paginas
    for (let i = 1; i < all_pages_data.length; i++) {
      const page_data = all_pages_data[i];

      if (page_data.higher_ad !== null) {
        if (higher_ad === null || page_data.higher_ad.price > higher_ad.price) {
          higher_ad = page_data.higher_ad;
        }
      }

      if (page_data.lower_ad !== null) {
        if (lower_ad === null || page_data.lower_ad.price < lower_ad.price) {
          lower_ad = page_data.lower_ad;
        }
      }

      ads = ads.concat(page_data.ads);
    }

    await browser.close();

    return {
      higher_ad,
      lower_ad,
      ads,
    };
  } catch (error) {}

  await browser.close();
  return {};
}

/**
 * Coleta todos os bairros de uma região.
 */
export async function extractNeighborhoods(link) {
  const browser = await puppeteer.launch({ headless: false });

  try {
    let tab = await browser.newPage(browser);
    tab.setViewport({
      width: 900,
      height: 100,
    });
    await tab.goto(link, { waitUntil: "domcontentloaded" });

    let neighborhoods_btn = await tab.waitForXPath("//button[div[text()[contains(., 'bairros / cidades')]]]");
    await neighborhoods_btn.scrollIntoView();
    await neighborhoods_btn.evaluate((element) => element.click());
    let neighborhoods_container = await tab.waitForSelector("div[role='dialog']");

    const neighborhoods = await neighborhoods_container.$$eval("label span:nth-child(2) span:nth-child(1)", (elements) =>
      elements.map((span) => span.textContent)
    );

    const neighborhoods_data = {};

    for (const neighbor of neighborhoods) {
      neighborhoods_data[neighbor] = neighbor
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Mn}/gu, "")
        .replace(/\s+/g, "-");
    }
    await browser.close();

    return neighborhoods_data;
  } catch (error) {}

  await browser.close();
  return {};
}
