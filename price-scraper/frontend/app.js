'use strict';

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const btn = document.getElementById('search-btn');
const loading = document.getElementById('loading');
const statusEl = document.getElementById('status');
const resultsHeader = document.getElementById('results-header');
const resultsCount = document.getElementById('results-count');
const shopsStatus = document.getElementById('shops-status');
const resultsGrid = document.getElementById('results-grid');
const noResults = document.getElementById('no-results');
const noResultsQuery = document.getElementById('no-results-query');

const SHOP_SLUG = {
  'bol.com': 'bol',
  'Amazon': 'amazon',
  'Coolblue': 'coolblue',
  'MediaMarkt': 'mediamarkt',
  'Fnac': 'fnac',
};

function formatPrice(eur) {
  return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(eur);
}

function formatUnitPrice(eur) {
  // Show up to 4 significant decimals so €0,2717 is readable, but €1,25 stays clean
  return new Intl.NumberFormat('nl-BE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(eur);
}

function shopBadge(shop) {
  const slug = SHOP_SLUG[shop] || 'bol';
  return `<span class="shop-badge shop-badge--${slug}">${shop}</span>`;
}

function renderCard(product) {
  const card = document.createElement('a');
  card.className = 'product-card';
  card.href = product.url;
  card.target = '_blank';
  card.rel = 'noopener noreferrer';

  const imgHtml = product.image_url
    ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.title)}" loading="lazy" />`
    : `<span class="no-image">Geen afbeelding</span>`;

  const unitPriceHtml = product.price_per_unit
    ? `<p class="product-card__unit-price">${formatUnitPrice(product.price_per_unit)} / stuk</p>`
    : '';

  card.innerHTML = `
    <div class="product-card__image-wrap">${imgHtml}</div>
    <div class="product-card__body">
      ${shopBadge(product.shop)}
      <p class="product-card__title">${escapeHtml(product.title)}</p>
      <p class="product-card__price">${formatPrice(product.price_eur)}</p>
      ${unitPriceHtml}
    </div>
  `;
  return card;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}

function setLoading(on) {
  loading.classList.toggle('hidden', !on);
  btn.disabled = on;
  input.disabled = on;
}

function clearResults() {
  resultsGrid.innerHTML = '';
  resultsHeader.classList.add('hidden');
  noResults.classList.add('hidden');
  statusEl.classList.add('hidden');
  statusEl.textContent = '';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = input.value.trim();
  if (!query) return;

  clearResults();
  setLoading(true);

  try {
    const res = await fetch(`/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Onbekende fout');
    }
    const data = await res.json();

    if (data.results.length === 0) {
      noResultsQuery.textContent = data.query;
      noResults.classList.remove('hidden');
    } else {
      // Render cards
      for (const product of data.results) {
        resultsGrid.appendChild(renderCard(product));
      }

      // Header
      const sortLabel = data.sorted_by_unit_price
        ? 'gesorteerd op prijs per stuk'
        : 'gesorteerd op totaalprijs';
      resultsCount.textContent = `${data.results.length} resultaten · ${sortLabel}`;

      if (data.shops_without_results && data.shops_without_results.length > 0) {
        shopsStatus.textContent = `Geen resultaten van: ${data.shops_without_results.join(', ')}`;
      } else {
        shopsStatus.textContent = 'Alle winkels hebben resultaten gevonden.';
      }

      resultsHeader.classList.remove('hidden');
    }
  } catch (err) {
    statusEl.textContent = `Fout: ${err.message}`;
    statusEl.classList.remove('hidden');
  } finally {
    setLoading(false);
  }
});
