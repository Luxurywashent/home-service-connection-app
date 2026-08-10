import "./load-env.js";
import { getDb } from "../server/db";
import { moduleTools } from "../drizzle/schema";
import { sql } from "drizzle-orm";

const imageMap = [
  // --- Original 21 images ---
  { keywords: ["red microfiber", "sealant towel", "red towel"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/ZjofflLZouKoQZSe.png" },
  { keywords: ["tornador", "tornado"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/cJYiwLxhdAcppeyc.png" },
  { keywords: ["all purpose towel", "all-purpose towel", "all purpose"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/XocATurCmdhXwZXo.png" },
  { keywords: ["long handle green", "long handle", "long-handle", "long green brush", "long brush"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/qxCDfYavpOwLzHOi.png" },
  { keywords: ["glass cleaning towel", "glass clean towel"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/YeMHlHMeMwpVpiaC.png" },
  { keywords: ["glass polish towel", "polish towel"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/MOdOZRXSLMSVufeK.png" },
  { keywords: ["pink dressing", "dressing"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/WyUuWySGaYNOjkkX.png" },
  { keywords: ["wash mitt", "mitt"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/vJdqkGiRzsiaLAFm.png" },
  { keywords: ["black handle brush", "black brush", "black tire brush", "black scrub brush"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/wXaMUZDsJOQJhjOC.png" },
  { keywords: ["solvent"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/bLlwoegqayfJRTUP.png" },
  { keywords: ["scrub ninja", "ninja"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/fFqaPVxuCIaWkccV.png" },
  { keywords: ["green handle brush", "green handle"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/ipBVCewgOzWyRAVJ.png" },
  { keywords: ["extractor"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/XILiwIdWttSHPImq.png" },
  { keywords: ["interior cleaner", "interior"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/utNXmdrBvPdoHuWW.png" },
  { keywords: ["drill brush", "drill"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/DxGfxBpncTuuAeRf.png" },
  { keywords: ["foam cannon", "foam gun"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/MdSmlKVantNXxJAK.png" },
  { keywords: ["pressure washer", "power washer"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/jWZSutCWTnyUoZkt.png" },
  { keywords: ["plastic razor", "razor blade", "plastic blade"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/ZvgzIJlVHZIkLqFy.png" },
  { keywords: ["alumabrite", "aluma brite"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/ITcnZtAbJoFAGjIb.png" },
  { keywords: ["brake buster"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/XiXCfkAIvMgCkSnX.png" },
  { keywords: ["bug sponge", "bug pad", "bug remover"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/GapDKqDfHnpQgPlL.png" },

  // --- New batch: user-uploaded photos ---
  { keywords: ["green wheel brush", "wheel brush"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/NgrTkVYSHkkcOzgc.png" },
  { keywords: ["wax towel"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/cHaOpXXLUysksseZ.png" },
  { keywords: ["windows cleaning towel", "window cleaning towel", "window towel"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/yMCOYlUOQLMUNfqA.png" },
  { keywords: ["window cleaner", "glass cleaner"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/YcKngpzKvFCbyYxZ.png" },
  { keywords: ["wheel acid"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/MRyQccHjYIsdlubL.png" },
  { keywords: ["acid"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/MRyQccHjYIsdlubL.png" },
  { keywords: ["square applicator pad", "square blue applicator pad", "applicator pad"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/NyDOwNQThCCdWror.png" },
  { keywords: ["circle applicator pad", "round applicator pad"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/xrWiGilrzhKLZQEt.png" },
  { keywords: ["grill brush"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/YFtAjXHqOnzXgUQA.jpeg" },
  { keywords: ["drying towel"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/mgxQHIHQrzxgDVdx.jpeg" },
  { keywords: ["toothbrush", "tooth brush"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/rzZOPqIjBhPMziLN.jpeg" },
  { keywords: ["window reach tool", "reach tool", "the reacher"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/ymyIIwtnrqxWWZoT.jpeg" },
  { keywords: ["reach tool towel"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/ymyIIwtnrqxWWZoT.jpeg" },
  { keywords: ["soap", "car soap", "wash soap"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/qqbVOEiEkwmySzgU.png" },
  { keywords: ["vacuum", "vac"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/qThklljXWITDeyMj.webp" },
  { keywords: ["leather lotion", "leather conditioner"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/YtvrlbEktUvtjVRl.png" },
  { keywords: ["leather brush"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/RJPWnhnVeKEpOUZe.jpeg" },
  { keywords: ["polish", "car polish", "finishing polish"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/RJdHyUZKxgYJRwSF.jpeg" },
  { keywords: ["paint sealant", "spray sealant"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/FdlZsgTGHvfIKNmu.png" },
  { keywords: ["brush head", "chenille brush head", "mop head"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/XMPfPEGXiywaZGAt.jpeg" },
  { keywords: ["crevice tool", "crevice attachment"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/fKfIlQIpWPkQYYVi.jpeg" },
  { keywords: ["degreaser"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/JILigzjcoBINUczJ.png" },
  { keywords: ["detail brush"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/eygLgaWKkrffIbOv.png" },

  // --- Web-sourced images ---
  { keywords: ["rain x", "rain-x", "rainx"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/oLrYfAmLhtSwLTJf.webp" },
  { keywords: ["glove", "nitrile glove", "black glove"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/wxIjJAjrJibOntlC.jpg" },
  { keywords: ["fureel", "fur eel", "fur-eel"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/drvpwrFgMnuOiRPE.jpg" },
  { keywords: ["ozone machine", "ozone generator"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/cKXgkBIvOYSvmWFd.jpg" },
  { keywords: ["extension cord"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/hSYHhFVcfXySiXzf.jpg" },
  { keywords: ["dual action polisher", "polisher", "machine polisher"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/toBZMeIOzIgCbeGI.jpg" },
  { keywords: ["analon", "analan"], url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/wiPSzlhBHvvAegbj.jpg" },
];

async function main() {
  const db = await getDb();
  if (!db) { console.error("DB not available"); process.exit(1); }

  // Get all tools (including those already with photos — we force-update aliases)
  const allTools = await db.select().from(moduleTools);
  console.log(`Total tools in DB: ${allTools.length}`);

  let updated = 0;
  let skipped = 0;
  const noMatch: string[] = [];

  for (const tool of allTools) {
    const nameLower = tool.name.toLowerCase();
    let matched = false;

    for (const entry of imageMap) {
      if (entry.keywords.some(kw => nameLower.includes(kw))) {
        // Only update if no photo yet, OR if this is a forced alias update
        if (!tool.photoUrl || entry.keywords.some(kw => ["black tire brush", "long green brush", "black scrub brush", "green wheel brush"].includes(kw))) {
          await db.update(moduleTools)
            .set({ photoUrl: entry.url })
            .where(sql`${moduleTools.id} = ${tool.id}`);
          console.log(`✅ Updated: "${tool.name}" (module: ${tool.moduleKey})`);
          updated++;
        } else {
          skipped++;
        }
        matched = true;
        break;
      }
    }

    if (!matched && !tool.photoUrl) {
      noMatch.push(`"${tool.name}" [${tool.category}] (module: ${tool.moduleKey})`);
    }
  }

  console.log(`\n========== RESULTS ==========`);
  console.log(`✅ Updated: ${updated}`);
  console.log(`⏭️  Skipped (already had photo): ${skipped}`);
  console.log(`❌ No matching image (${noMatch.length}):`);
  noMatch.forEach(n => console.log(`   - ${n}`));

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
