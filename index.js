import { extractRegion, extractNeighborhoods } from "./olx.js";
import { writeFileSync } from "fs";

(async () => {
  const neighbors_list = await extractNeighborhoods("https://www.olx.com.br/imoveis/estado-pe/grande-recife/recife/");
  console.log(neighbors_list);

  writeFileSync("list.json", JSON.stringify(neighbors_list, null, 4), (err) => err && console.error(err));

  const region_result = await extractRegion("https://www.olx.com.br/imoveis/estado-pe/grande-recife/recife/zumbi");

  writeFileSync("output.json", JSON.stringify(region_result, null, 4), (err) => err && console.error(err));

  process.exit(0);
})();
