-- Eliminar filas duplicadas de features basándose en el título
DELETE FROM features 
WHERE id NOT IN (
  SELECT MIN(id) 
  FROM features 
  GROUP BY title
);
