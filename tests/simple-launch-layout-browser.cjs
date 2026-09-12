const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const playwrightPath = process.env.PLAYWRIGHT_MODULE || process.argv[2] || "playwright";
const { chromium } = require(playwrightPath);

const root = path.join(__dirname, "..");
const globalCss = fs.readFileSync(path.join(root, "src/styles/globals.css"), "utf8");
const launchCss = fs.readFileSync(path.join(root, "src/components/PonsLaunchpad.module.css"), "utf8");
const tradingCss = fs.readFileSync(path.join(root, "src/components/NodeTrading.module.css"), "utf8");
const widths = [375, 768, 1024, 1440];

function contained(inner, outer, tolerance = 1) {
  return inner.left >= outer.left - tolerance && inner.right <= outer.right + tolerance;
}

(async () => {
  const launchOptions = { headless: true };
  if (process.env.PLAYWRIGHT_EXECUTABLE) launchOptions.executablePath = process.env.PLAYWRIGHT_EXECUTABLE;
  else launchOptions.channel = "msedge";
  const browser = await chromium.launch(launchOptions);
  const results = [];
  try {
    const page = await browser.newPage({ viewport: { width: widths[0], height: 1000 } });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.setContent(`<style>${globalCss}\n${launchCss}</style><main class="page"><div class="shell"><div class="formPane"><label class="field">Name<input value="HOOD"></label></div><aside class="previewPane"><div class="previewCard"><h2>HOOD</h2></div></aside></div></main>`);
      const launch = await page.evaluate(() => {
        const rect = (selector) => {
          const { left, right, top, bottom, width: rectWidth } = document.querySelector(selector).getBoundingClientRect();
          return { left, right, top, bottom, width: rectWidth };
        };
        const shell = document.querySelector(".shell");
        return {
          columns: getComputedStyle(shell).gridTemplateColumns.split(/\s+/).filter(Boolean),
          shell: rect(".shell"), form: rect(".formPane"), preview: rect(".previewPane"), input: rect("input"),
          shellScrollWidth: shell.scrollWidth, shellClientWidth: shell.clientWidth,
        };
      });
      assert.equal(launch.columns.length, width <= 820 ? 1 : 2, `${width}px launch grid column count`);
      assert.ok(contained(launch.form, launch.shell), `${width}px launch form is clipped`);
      assert.ok(contained(launch.preview, launch.shell), `${width}px launch preview is clipped`);
      assert.ok(contained(launch.input, launch.form), `${width}px launch input is clipped`);
      assert.ok(launch.shellScrollWidth <= launch.shellClientWidth, `${width}px launch shell overflows`);
      if (width <= 820) {
        assert.ok(Math.abs(launch.form.width - launch.preview.width) <= 1, `${width}px launch panes are not full-width rows`);
      } else {
        assert.ok(launch.form.width > launch.preview.width && launch.preview.width >= 300, `${width}px desktop launch columns are malformed`);
      }

      for (const status of ["pending", "unknown", "confirmed"]) {
        const operationBody = status === "confirmed"
          ? `<strong>Trade confirmed</strong><details class="operationDetails"><summary>Transaction details</summary></details>`
          : `<strong>${status}</strong><p>Recorded operation message</p><button class="secondaryButton">Refresh transaction status</button><details class="operationDetails"><summary>Transaction details</summary></details>`;
        await page.setContent(`<style>${globalCss}\n${tradingCss}</style><section class="trading"><div class="body"><div class="nodes"><article class="node"><div class="nodeHeader"><div><span>Node 1</span><code>0x1234…567890</code></div></div><dl class="metrics"><div><dt>ETH balance</dt><dd>1 ETH</dd></div><div><dt>Token balance</dt><dd>100</dd></div><div><dt>Share</dt><dd>1%</dd></div></dl><div class="operation">${operationBody}</div><div class="tradeGroups"><div class="tradeGroup"><span>Buy</span><div class="tradeButtons"><button>5%</button><button>10%</button><button>25%</button><button>50%</button><button>Buy Max</button></div><div class="customTrade"><label><span>Custom buy</span><input value="0.001"></label><button class="secondaryButton">Buy amount</button></div></div><div class="tradeGroup"><span>Sell</span><div class="tradeButtons"><button>5%</button><button>10%</button><button>25%</button><button>50%</button><button>Sell Max</button></div><div class="customTrade"><label><span>Custom sell</span><input value="10"></label><button class="secondaryButton">Sell amount</button></div></div></div></article></div></div></section>`);
        const trading = await page.evaluate(() => {
          const rect = (selector) => {
            const { left, right, top, bottom, width: rectWidth } = document.querySelector(selector).getBoundingClientRect();
            return { left, right, top, bottom, width: rectWidth };
          };
          const node = document.querySelector(".node");
          const buttons = [...document.querySelectorAll(".tradeButtons button,.customTrade button")];
          const inputs = [...document.querySelectorAll(".customTrade input")];
          return {
            node: rect(".node"), header: rect(".nodeHeader"), metrics: rect(".metrics"), trades: rect(".tradeGroups"), operation: rect(".operation"),
            columns: getComputedStyle(node).gridTemplateColumns.split(/\s+/).filter(Boolean),
            tradeColumn: getComputedStyle(document.querySelector(".tradeGroups")).gridColumnStart,
            controlHeights: [...buttons, ...inputs].map((element) => element.getBoundingClientRect().height),
            clippedChildren: [...node.children].filter((element) => {
              const child = element.getBoundingClientRect();
              const outer = node.getBoundingClientRect();
              return child.left < outer.left - 1 || child.right > outer.right + 1;
            }).length,
            nodeScrollWidth: node.scrollWidth, nodeClientWidth: node.clientWidth,
          };
        });
        assert.equal(trading.columns.length, width >= 901 ? 3 : 1, `${width}px ${status} node column count`);
        assert.equal(trading.clippedChildren, 0, `${width}px ${status} node clips a direct child`);
        assert.ok(trading.nodeScrollWidth <= trading.nodeClientWidth, `${width}px ${status} node overflows`);
        assert.ok(trading.controlHeights.every((height) => height >= 44), `${width}px ${status} trade target is under 44px`);
        if (width >= 901) {
          assert.equal(trading.tradeColumn, "3", `${width}px ${status} trade controls are not in column 3`);
          assert.ok(trading.header.left < trading.metrics.left && trading.metrics.left < trading.trades.left, `${width}px ${status} primary row order is wrong`);
          assert.ok(trading.operation.top >= Math.max(trading.header.bottom, trading.metrics.bottom, trading.trades.bottom), `${width}px ${status} operation overlaps or precedes the trade row`);
        }
        results.push({ width, status, launchColumns: launch.columns, nodeColumns: trading.columns, tradeColumn: trading.tradeColumn, minControlHeight: Math.min(...trading.controlHeights), clippedChildren: trading.clippedChildren });
      }
    }
    console.log(JSON.stringify({ check: "simple-launch-responsive-layout", pass: true, results }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
