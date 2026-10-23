-- Agregar columnas show_on_page y show_on_modal si no existen
ALTER TABLE features 
ADD COLUMN IF NOT EXISTS show_on_page BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS show_on_modal BOOLEAN DEFAULT false;

-- Actualizar datos existentes
UPDATE features SET show_on_page = true, show_on_modal = false WHERE show_on_page IS NULL;
