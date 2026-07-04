// Aurelle & Co. demo storefront. Renders the grid (index.html) and the
// product detail page (product.html?id=...) from products.json.
(async function () {
  const res = await fetch('/products.json');
  const products = await res.json();
  const money = (n) => `$${n.toFixed(0)}`;

  const grid = document.getElementById('product-grid');
  if (grid) {
    grid.innerHTML = products.map((p) => `
      <a class="card" href="/product.html?id=${p.id}">
        <div class="card-media">
          <img src="${p.modelImage}" alt="${p.name} worn by a model"
               data-mirror-product="${p.id}" data-mirror-name="${p.name}" data-mirror-mode="mirror">
        </div>
        <div class="card-body">
          <h3>${p.name}</h3>
          <p class="price">${money(p.price)}</p>
        </div>
      </a>
    `).join('');
  }

  const detail = document.getElementById('product-detail');
  if (detail) {
    const id = new URLSearchParams(location.search).get('id');
    const p = products.find((x) => x.id === id) || products[0];
    document.title = `${p.name} — Aurelle & Co.`;
    const crumb = document.getElementById('crumb-name');
    if (crumb) crumb.textContent = p.name;

    detail.innerHTML = `
      <div class="detail-media">
        <figure class="shot shot-model">
          <img src="${p.modelImage}" alt="${p.name} worn by a model"
               data-mirror-product="${p.id}" data-mirror-name="${p.name}" data-mirror-mode="mirror">
          <figcaption>On the model</figcaption>
        </figure>
        <figure class="shot shot-flat">
          <img src="${p.flatImage}" alt="${p.name} product photo"
               data-mirror-product="${p.id}" data-mirror-name="${p.name}">
          <figcaption>The piece</figcaption>
        </figure>
      </div>
      <div class="detail-info">
        <p class="category">${p.category}</p>
        <h1>${p.name}</h1>
        <p class="price big">${money(p.price)}</p>
        <p class="description">${p.description}</p>
        <div class="sizes" role="group" aria-label="Size">
          ${['XS', 'S', 'M', 'L', 'XL'].map((s, i) => `<button class="size${i === 2 ? ' selected' : ''}" type="button">${s}</button>`).join('')}
        </div>
        <button class="add-to-bag" type="button" onclick="this.textContent='Added to bag'; setTimeout(()=>this.textContent='Add to bag', 1500)">Add to bag</button>
        <p class="detail-note">Free shipping over $150 · Free returns within 30 days</p>
      </div>
    `;
  }

  // Size selector toggle (cosmetic only)
  document.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('size')) {
      document.querySelectorAll('.size').forEach((b) => b.classList.remove('selected'));
      e.target.classList.add('selected');
    }
  });
})();
