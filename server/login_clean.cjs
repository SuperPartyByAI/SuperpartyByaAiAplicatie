// Script izolat pentru logare curata (CommonJS)
const puppeteer = require('puppeteer');
(async () => {
    console.log("-> Pornim o instanta complet NOUA si CURATA de browser...");
    const browser = await puppeteer.launch({ 
        headless: false,
        args: [
            '--no-sandbox',
            '--window-size=1280,800',
            '--disable-blink-features=AutomationControlled'
        ]
    });
    
    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();
    
    // Evitare bot-detection de baza
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });
    });

    try {
        console.log("-> Accesam pagina principala Twilio...");
        await page.goto('https://login.twilio.com/u/login', { waitUntil: 'domcontentloaded' });
        
        console.log("-> Asteptam campul de email...");
        await page.waitForSelector('input[name="email"]', { timeout: 15000 });
        
        console.log("-> Introducem email...");
        await page.type('input[name="email"]', 'Superpartybyai@gmail.com', { delay: 110 });
        await page.keyboard.press('Enter');
        
        console.log("-> Asteptam pasul de parola sau Cloudflare...");
        await page.waitForTimeout(5000); 
        
        const parolaVizibila = await page.$('input[name="password"]');
        if (parolaVizibila) {
             console.log("-> Introducem parola...");
             await page.type('input[name="password"]', 'Andrei209521!', { delay: 130 });
             await page.keyboard.press('Enter');
             console.log("-> Am trimis parola. Asteptam 2FA...");
             
             await page.waitForTimeout(10000); 
             console.log("-> Stadiu Final dupa login click. URL Curent:", page.url());
             const body = await page.content();
             if (body.includes("verification code") || body.includes("sent a code") || body.includes("2FA")) {
                  console.log("\n=============================");
                  console.log("  >>> NE CERE CODUL 2FA! <<<");
                  console.log("=============================\n");
             }
        } else {
             console.log("\n*****************************");
             console.log("-> BLOCAT LA CAPTCHA/BOT: Nu gasesc campul de parola. Urmareste ecranul deschis pentru a ajuta scriptul manual.");
             console.log("*****************************\n");
        }
        
    } catch (e) {
        console.error("-> EROARE LA RULARE:", e.message);
    } finally {
        console.log("-> Astept 5 minute cu fereastra deschisa pentru a putea interveni manual daca e nevoie...");
        await page.waitForTimeout(300000); // 5 minute
        await browser.close();
    }
})();
