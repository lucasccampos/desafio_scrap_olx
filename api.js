import { extractRegion, extractNeighborhoods } from "./olx.js";
import express from "express";

const app = express();
const PORT = 3000;

// RECIFE LINK
const CITY_REGION_LINK = "https://www.olx.com.br/imoveis/estado-pe/grande-recife/recife/";

/**
 * Retorna todos os bairros de uma região.
 */
app.get("/region_list", async (req, res) => {
  try {
    const result = await extractNeighborhoods(CITY_REGION_LINK);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: "An error occurred while fetching data." });
  }
});

/**
 * Retorna todos os anuncios de uma determinada sub-região
 * Caso nenhuma sub-região for passada retorna todos os anuncios da região 'global'
 */
app.get("/region/:subRegion_name?", async (req, res) => {
  try {
    const subRegion_name = req.params.subRegion_name;
    const result = await extractRegion(CITY_REGION_LINK + (subRegion_name ? subRegion_name : ""));

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ msg: "An error occurred while fetching data.", error });
  }
});

app.listen(PORT, () => {
  console.log(`Express server is running on http://localhost:${PORT}`);
});
