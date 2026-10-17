(() => {
  const storageKey = 'litlayer-cart-v1';
  let cart;

  try {
    cart = JSON.parse(localStorage.getItem(storageKey) || '[]');
  } catch {
    cart = [];
  }

  if (!Array.isArray(cart)) cart = [];
  cart = cart.filter(item =>
    item &&
    typeof item.name === 'string' &&
    Number.isFinite(item.price) &&
    item.price > 0 &&
    Number.isInteger(item.quantity) &&
    item.quantity > 0 &&
    item.quantity <= 99
  );

  const money = value => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(value);

  function cartCount() {
    return cart.reduce((total, item) => total + item.quantity, 0);
  }

  function updateCartLinks() {
    const count = cartCount();
    document.querySelectorAll('[data-cart-count]').forEach(element => {
      element.textContent = count ? ` (${count})` : '';
    });
    document.querySelectorAll('[data-cart-link]').forEach(link => {
      link.setAttribute('aria-label', count
        ? `View shopping cart with ${count} item${count === 1 ? '' : 's'}`
        : 'View shopping cart');
    });
  }

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(cart));
    } catch {}
    updateCartLinks();
    renderCartPage();
  }

  function cartTotals() {
    const count = cartCount();
    const subtotal = cart.reduce((total, item) => total + item.price * item.quantity, 0);
    const shipping = count === 0 || count >= 4 ? 0 : 10;
    const discount = Math.max(0, count - 4) * 5;
    return { count, subtotal, shipping, discount, total: subtotal - discount + shipping };
  }

  function createButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  function renderCartPage() {
    const container = document.querySelector('[data-cart-page]');
    if (!container) return;

    container.replaceChildren();

    if (!cart.length) {
      const empty = document.createElement('div');
      empty.className = 'cart-empty';
      const heading = document.createElement('h2');
      heading.textContent = 'Your cart is empty';
      const message = document.createElement('p');
      message.textContent = 'Browse the light boxes and add your favorites when you are ready.';
      const shop = document.createElement('a');
      shop.className = 'btn';
      shop.href = 'index.html';
      shop.textContent = 'Continue Shopping';
      empty.append(heading, message, shop);
      container.append(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'cart-items';

    cart.forEach((item, index) => {
      const row = document.createElement('article');
      row.className = 'cart-row';

      const details = document.createElement('div');
      const name = document.createElement('h2');
      name.textContent = item.name;
      const price = document.createElement('p');
      price.textContent = `${money(item.price)} each`;
      details.append(name, price);

      const controls = document.createElement('div');
      controls.className = 'cart-controls';
      const quantityLabel = document.createElement('label');
      quantityLabel.textContent = 'Quantity';
      const quantity = document.createElement('input');
      quantity.type = 'number';
      quantity.min = '1';
      quantity.max = '99';
      quantity.value = String(item.quantity);
      quantity.setAttribute('aria-label', `Quantity for ${item.name}`);
      quantity.addEventListener('change', () => {
        item.quantity = Math.max(1, Math.min(99, Math.floor(Number(quantity.value) || 1)));
        save();
      });
      const remove = createButton('Remove', 'btn btn-secondary', () => {
        cart.splice(index, 1);
        save();
      });
      quantityLabel.append(quantity);
      controls.append(quantityLabel, remove);
      row.append(details, controls);
      list.append(row);
    });

    const totals = cartTotals();
    const summary = document.createElement('aside');
    summary.className = 'cart-summary';
    summary.innerHTML = `
      <h2>Order Summary</h2>
      <div><span>Items (${totals.count})</span><strong>${money(totals.subtotal)}</strong></div>
      <div><span>Discount</span><strong>-${money(totals.discount)}</strong></div>
      <div><span>Shipping</span><strong>${totals.shipping ? money(totals.shipping) : 'Free'}</strong></div>
      <div class="cart-total"><span>Total</span><strong>${money(totals.total)}</strong></div>
      <p>Free shipping with 4+ lights. The fifth light and each additional light receive $5 off.</p>`;

    const form = document.createElement('form');
    form.action = 'https://www.paypal.com/cgi-bin/webscr';
    form.method = 'post';
    form.target = '_blank';
    form.className = 'paypal-form cart-checkout';

    const fields = {
      cmd: '_cart',
      upload: '1',
      business: 'foxvalleysoccer@gmail.com',
      currency_code: 'USD',
      handling_cart: totals.shipping.toFixed(2),
      discount_amount_cart: totals.discount.toFixed(2)
    };

    cart.forEach((item, index) => {
      const number = index + 1;
      fields[`item_name_${number}`] = item.name;
      fields[`amount_${number}`] = item.price.toFixed(2);
      fields[`quantity_${number}`] = String(item.quantity);
    });

    Object.entries(fields).forEach(([name, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.append(input);
    });

    const checkout = document.createElement('button');
    checkout.type = 'submit';
    checkout.className = 'btn btn-paypal';
    checkout.textContent = 'Continue to PayPal';
    form.append(checkout);
    form.addEventListener('submit', () => {
      if (typeof gtag === 'function') {
        gtag('event', 'begin_checkout', {
          currency: 'USD',
          value: totals.total,
          shipping: totals.shipping,
          discount: totals.discount,
          items: cart.map(item => ({
            item_name: item.name,
            price: item.price,
            quantity: item.quantity
          })),
          transport_type: 'beacon'
        });
      }
    });
    summary.append(form);

    const layout = document.createElement('div');
    layout.className = 'cart-layout';
    layout.append(list, summary);
    container.append(layout);
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-cart-item]');
    if (!button) return;

    const item = JSON.parse(button.dataset.cartItem);
    const existing = cart.find(cartItem => cartItem.name === item.name && cartItem.price === item.price);
    if (existing) existing.quantity++;
    else cart.push({ ...item, quantity: 1 });
    save();

    const originalLabel = button.textContent;
    button.textContent = 'Added to Cart';
    button.disabled = true;
    window.setTimeout(() => {
      button.textContent = originalLabel;
      button.disabled = false;
    }, 1200);
  });

  updateCartLinks();
  renderCartPage();
})();
