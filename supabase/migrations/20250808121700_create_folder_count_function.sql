CREATE OR REPLACE FUNCTION get_candidate_counts_by_folder()
RETURNS TABLE(carpeta_id BIGINT, count BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.carpeta_id,
        COUNT(c.id)
    FROM
        v2_candidatos c
    WHERE
        c.carpeta_id IS NOT NULL
    GROUP BY
        c.carpeta_id;
END;
$$ LANGUAGE plpgsql;
