/* Thin wrappers over the Express API. */

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

export const getProjects = (qs) => getJSON(`/api/projects?${qs}`);
export const getProjectFacets = () => getJSON('/api/facets');
export const getStats = () => getJSON('/api/stats');

export const getRentals = (qs) => getJSON(`/api/rentals?${qs}`);
export const getRentalFacets = () => getJSON('/api/rentals/facets');

export const getRoads = () => getJSON('/api/roads');
