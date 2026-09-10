import asyncio, json, pathlib
from playwright.async_api import async_playwright

import functools, http.server, socketserver, threading
PORT = 8931
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory="/dev-server/dist-print-proof")
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/index.html?fixture=short"
out = {}

async def main():
    async with async_playwright() as p:
        for headless in (True, False):
            try:
                b = await p.chromium.launch(headless=headless)
            except Exception as e:
                out[f"headless={headless}"] = {"launch_error": str(e)[:200]}
                continue
            ctx = await b.new_context(viewport={"width":1280,"height":1800})
            pg = await ctx.new_page()
            errs = []
            pg.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
            pg.on("pageerror", lambda e: errs.append(str(e)))
            await pg.goto(URL, wait_until="domcontentloaded")
            # 1. does the environment even have window.print?
            has_print = await pg.evaluate("typeof window.print")
            # 2. instrument: does the click reach window.print?
            await pg.evaluate("void (window.__calls = 0, window.print = () => { window.__calls++; })")
            await pg.get_by_test_id("print-proof-print-button").click()
            calls = await pg.evaluate("window.__calls")
            res1 = await pg.evaluate("window.__printProof.lastPrint")
            # 3. throwing print -> failed, no fake success
            await pg.evaluate("void (window.print = () => { throw new Error('blocked by host'); })")
            await pg.get_by_test_id("print-proof-print-button").click()
            res2 = await pg.evaluate("JSON.parse(JSON.stringify({status:window.__printProof.lastPrint.status,message:window.__printProof.lastPrint.message}))")
            # 4. missing print -> unavailable
            await pg.evaluate("void (window.print = undefined)")
            await pg.get_by_test_id("print-proof-print-button").click()
            res3 = await pg.evaluate("window.__printProof.lastPrint.status")
            # 5. real, uninstrumented native print (fresh page) — does it throw / hang?
            pg2 = await ctx.new_page()
            await pg2.goto(URL, wait_until="domcontentloaded")
            native = await pg2.evaluate("""(async()=>{const t=Date.now();try{window.print();return {ok:true,ms:Date.now()-t};}catch(e){return {ok:false,err:String(e),ms:Date.now()-t};}})()""")
            out[f"headless={headless}"] = {"typeof_window_print": has_print, "calls_from_click": calls,
                "click_result": res1, "throwing": res2, "missing": res3,
                "native_print": native, "console_errors": errs}
            await b.close()
    print(json.dumps(out, ensure_ascii=False, indent=2))

asyncio.run(main())
