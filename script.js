// Remembers the chosen photo until posting is done
let currentPhoto = null;

// Remembers which listing the user tapped
let currentItemIndex = null;

// Open/close the sell popup
function toggleSellPage() {
  document.getElementById("sellModal").classList.toggle("show");
}

// Shrink + preview the chosen photo so it fits in localStorage
function previewPhoto() {
  const file = document.getElementById("itemPhoto").files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      // Draw the image onto a small canvas (max 400px wide)
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 400 / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Export as compressed JPEG (~10x smaller than the original!)
      currentPhoto = canvas.toDataURL("image/jpeg", 0.7);

      document.getElementById("photoPreview").innerHTML =
        `<img src="${currentPhoto}" alt="preview">`;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// Show/hide the filters
function toggleFilters() {
  document.getElementById("filterPanel").classList.toggle("show");
}

// Load saved listings
function loadListings() {
 document.getElementById("filterBanner").style.display = "none";   // ← add this line
  const listingsDiv = document.querySelector(".listings");
  const saved = JSON.parse(localStorage.getItem("marketaListings")) || [];

  saved.forEach(function(item, index) {
    const card = createCard(item, index);
    listingsDiv.prepend(card);
  });
}

// Turn a listing object into a clickable card
function createCard(item, index) {
  const card = document.createElement("div");
  card.className = "listing";
  card.onclick = function() { showDetail(index); };

        card.innerHTML =
        '<div class="thumb">' + (item.photo ? '<img src="' + item.photo + '" style="width:100%;height:100%;object-fit:cover;">' : '📦') + '</div>' +
        '<h3>' + item.name + '</h3>' +
        '<p class="price">GH₵ ' + Number(item.price).toLocaleString() + '</p>' +
        '<p class="location">📍 ' + item.location + ' • ' + item.condition + '</p>';
  return card;
}

// Show the detail popup for one listing
function showDetail(index) {
  const saved = JSON.parse(localStorage.getItem("marketaListings")) || [];
  const item = saved[index];

  if (!item) return;
  currentItemIndex = index;

  document.getElementById("detailPhoto").innerHTML = item.photo
    ? `<img src="${item.photo}" alt="">`
    : "📦";

  document.getElementById("detailName").textContent = item.name;
  document.getElementById("detailPrice").textContent = "GH₵ " + Number(item.price).toLocaleString();
  document.getElementById("detailMeta").textContent = "📍 " + item.location + " • " + item.condition;
  document.getElementById("detailNegotiable").textContent = item.negotiable ? "💬 Price Negotiable" : "💰 Fixed Price";
  document.getElementById("detailDescription").textContent = item.description || "No description provided.";

  document.getElementById("detailModal").classList.add("show");
}

// Close detail modal by tapping the dark background
document.getElementById("detailModal").addEventListener("click", function(e) {
  if (e.target === this) {
    this.classList.remove("show");
  }
});

// Close orders modal by tapping the dark background
document.getElementById("ordersModal").addEventListener("click", function(e) {
  if (e.target === this) {
    this.classList.remove("show");
  }
});

// Close shop modal by tapping the dark background
document.getElementById("shopModal").addEventListener("click", function(e) {
  if (e.target === this) {
    this.classList.remove("show");
  }
});

// Open the escrow checkout
function startEscrow() {
  const saved = JSON.parse(localStorage.getItem("marketaListings")) || [];
  const item = saved[currentItemIndex];

  if (!item) return;

  document.getElementById("escrowItemName").textContent = item.name;
  document.getElementById("escrowItemPrice").textContent = "Item price: GH₵ " + Number(item.price).toLocaleString();

  const total = Number(item.price) + 50;
  document.getElementById("escrowTotal").textContent = "GH₵ " + total.toLocaleString();

  document.getElementById("escrowStep1").style.display = "block";
  document.getElementById("escrowStep2").style.display = "none";
  document.getElementById("buyerPhone").value = "";
  document.getElementById("buyerLocation").value = "";

  document.getElementById("detailModal").classList.remove("show");
  document.getElementById("escrowModal").classList.add("show");
}

// Validate, save the order, show confirmation
function confirmOrder() {
  const phone = document.getElementById("buyerPhone").value;
  const location = document.getElementById("buyerLocation").value;

  if (!phone || !location) {
    alert("Please enter your phone number and delivery location! 🙏");
    return;
  }

  const saved = JSON.parse(localStorage.getItem("marketaListings")) || [];
  const item = saved[currentItemIndex];
  if (!item) return;

  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];
  const refNumber = "MKT-" + String(orders.length + 1).padStart(4, "0");

  const order = {
    ref: refNumber,
    itemId: item.id || null,
    itemName: item.name,
    itemPrice: Number(item.price),
    deliveryFee: 50,
    total: Number(item.price) + 50,
    buyerPhone: phone,
    buyerLocation: location,
    status: "Paid — funds held in escrow",
    date: new Date().toLocaleDateString()
  };

  orders.push(order);
  localStorage.setItem("marketaOrders", JSON.stringify(orders));

  document.getElementById("orderRef").textContent = refNumber;
  document.getElementById("escrowStep1").style.display = "none";
  document.getElementById("escrowStep2").style.display = "block";
}

// Close the escrow modal
function closeEscrow() {
  document.getElementById("escrowModal").classList.remove("show");
}

// Open My Orders
function openOrders() {
  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];
  const listDiv = document.getElementById("ordersList");
  const noOrders = document.getElementById("noOrders");

  listDiv.innerHTML = "";

  if (orders.length === 0) {
    noOrders.style.display = "block";
  } else {
    noOrders.style.display = "none";

    orders.forEach(function(order, index) {
      const card = document.createElement("div");
      card.className = "order-card";

      const released = order.status === "Funds released to seller";
      const shipped = order.status === "Shipped — on the way";

      let badge;

      if (released) {
        badge = `<span class="status-badge status-released">✅ Funds Released</span>`;
      } else if (shipped) {
        badge = `<span class="status-badge status-shipped">🚚 Shipped — on the way!</span>
                 <br><button class="release-btn" onclick="releaseFunds(${index})">✅ Confirm Delivery — Release Payment</button>`;
      } else {
        badge = `<span class="status-badge status-held">🔒 Funds Held in Escrow</span>
                 <br><button class="release-btn" onclick="releaseFunds(${index})">✅ Confirm Delivery — Release Payment</button>`;
      }

     card.innerHTML =
      '<b>' + order.ref + '</b> — ' + order.itemName +
      '<br>Total paid: GH₵ ' + order.total.toLocaleString() +
      '<br>Date: ' + order.date +
      '<br>' + badge +
      '<br><button class="delete-btn" onclick="deleteOrder(' + index + ')">🗑️ Delete Order</button>';

      listDiv.appendChild(card);
    });
  }

  document.getElementById("ordersModal").classList.add("show");
}


// Release escrow funds when buyer confirms delivery
function releaseFunds(index) {
  if (!confirm("Did you receive the item in good condition? Payment will be released to the seller.")) {
    return;
  }

  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];
  orders[index].status = "Funds released to seller";
  localStorage.setItem("marketaOrders", JSON.stringify(orders));

  openOrders();
}

// Delete an order from My Orders (with safety guard!)
function deleteOrder(index) {
  if (!confirm("Delete this order permanently? This cannot be undone.")) {
    return;
  }

  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];
  orders.splice(index, 1);
  localStorage.setItem("marketaOrders", JSON.stringify(orders));

  openOrders();
}

// Close My Orders
function closeOrders() {
  document.getElementById("ordersModal").classList.remove("show");
}

// Open My Shop — listings AND incoming orders with owner controls
function openShop() {
  const saved = JSON.parse(localStorage.getItem("marketaListings")) || [];
  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];
  const listDiv = document.getElementById("shopList");
  const noItems = document.getElementById("noShopItems");

  listDiv.innerHTML = "";

  if (saved.length === 0 && orders.length === 0) {
    noItems.style.display = "block";
  } else {
    noItems.style.display = "none";

    // --- Incoming orders section ---
    if (orders.length > 0) {
      const heading = document.createElement("h3");
      heading.textContent = "📥 Incoming Orders";
      listDiv.appendChild(heading);
    }

    orders.forEach(function(order) {
      const card = document.createElement("div");
      card.className = "shop-order";

      const shipped = order.status === "Shipped — on the way";
      const released = order.status === "Funds released to seller";

      let action;

      if (released) {
        action = `<span class="status-badge status-released">✅ Delivered — Payment Released</span>`;
      } else if (shipped) {
        action = `<span class="status-badge status-shipped">🚚 Shipped — awaiting buyer confirmation</span>`;
      } else {
        action = `<button class="ship-btn" onclick="markShipped('${order.ref}')">🚚 Mark as Shipped</button>`;
      }

    card.innerHTML =
      '<b>' + order.ref + '</b> — ' + order.itemName +
      '<br>💰 GH₵ ' + order.total.toLocaleString() + ' (held in escrow)' +
      '<br>📞 Buyer: ' + order.buyerPhone + ' • 📍 ' + order.buyerLocation +
      '<br>' + action;

      listDiv.appendChild(card);
    });

    // --- My listings section ---
    if (saved.length > 0) {
      const heading2 = document.createElement("h3");
      heading2.textContent = "🛍️ My Listings";
      listDiv.appendChild(heading2);
    }

    saved.forEach(function(item, index) {
      const card = document.createElement("div");
      card.className = "shop-card";

      const info = "• 📍 " + item.location + " • " + item.condition;

      card.innerHTML = `
        <span class="shop-item-name">${item.name}</span>
        <br>
        <span class="shop-item-price">GH₵ ${Number(item.price).toLocaleString()}</span>
        ${info}
        <div class="shop-actions">
          <button class="delete-btn" onclick="deleteListing(${index})">🗑️ Delete</button>
        </div>
      `;
      listDiv.appendChild(card);
    });
  }

  document.getElementById("shopModal").classList.add("show");
}

// Seller marks an order as shipped
function markShipped(ref) {
  if (!confirm("Mark this order as shipped? The buyer will be waiting for delivery.")) {
    return;
  }

  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];

  orders.forEach(function(order) {
    if (order.ref === ref) {
      order.status = "Shipped — on the way";
    }
  });

  localStorage.setItem("marketaOrders", JSON.stringify(orders));
  openShop(); // re-render
  alert("Marked as shipped! 🚚 The buyer can now see the status.");
}

// Delete one of your listings (with safety guard!)
function deleteListing(index) {
  if (!confirm("Delete this listing permanently? This cannot be undone.")) {
    return;
  }

  const saved = JSON.parse(localStorage.getItem("marketaListings")) || [];
  saved.splice(index, 1);
  localStorage.setItem("marketaListings", JSON.stringify(saved));

  openShop();

  const listingsDiv = document.querySelector(".listings");
  listingsDiv.innerHTML = "";
  loadListings();
}

// Close My Shop
function closeShop() {
  document.getElementById("shopModal").classList.remove("show");
}

// Post a new listing
function postListing() {
  const item = {
    id: Date.now(),
    name: document.getElementById("itemName").value,
    price: document.getElementById("itemPrice").value,
    location: document.getElementById("itemLocation").value,
    category: document.getElementById("itemCategory").value,
    condition: document.getElementById("itemCondition").value,
    description: document.getElementById("itemDescription").value,
    negotiable: document.getElementById("itemNegotiable").checked,
    photo: currentPhoto
  };

  if (!item.name || !item.price || !item.location || !item.category || !item.condition) {
    alert("Please fill in all fields! 🙏");
    return;
  }

    const saved = JSON.parse(localStorage.getItem("marketaListings")) || [];
  saved.push(item);

  try {
    localStorage.setItem("marketaListings", JSON.stringify(saved));
  } catch (err) {
    alert("❌ Storage is full! Try a smaller photo or delete old listings.");
    return;
  }
  document.querySelector(".listings").prepend(createCard(item, saved.length - 1));

  document.getElementById("itemName").value = "";
  document.getElementById("itemPrice").value = "";
  document.getElementById("itemLocation").value = "";
  document.getElementById("itemDescription").value = "";
  document.getElementById("itemNegotiable").checked = false;
  document.getElementById("itemCategory").value = "";
  document.getElementById("itemCondition").value = "";
  currentPhoto = null;
  document.getElementById("photoPreview").innerHTML = "📷";
  toggleSellPage();

  alert("Listing posted! 🎉");
}

// Apply all filters together
function applyFilters() {
  const query = document.getElementById("searchBox").value.toLowerCase();
  const condition = document.getElementById("filterCondition").value;
  const minPrice = Number(document.getElementById("minPrice").value) || 0;
  const maxPrice = Number(document.getElementById("maxPrice").value) || Infinity;

  const listings = document.querySelectorAll(".listing");

  listings.forEach(function(listing) {
    const text = listing.textContent.toLowerCase();
    const priceText = listing.querySelector(".price").textContent;
    const price = Number(priceText.replace(/[^0-9]/g, ""));

    const matchesSearch = text.includes(query);
    const matchesCondition = condition === "" || text.includes(condition.toLowerCase());
    const matchesPrice = price >= minPrice && price <= maxPrice;

    if (matchesSearch && matchesCondition && matchesPrice) {
      listing.style.display = "block";
    } else {
      listing.style.display = "none";
    }
  });
}

// Search button: reveal filters, then filter
function searchListings() {
  document.getElementById("filterPanel").classList.add("show");
  applyFilters();
}

function chatSeller() {
  alert("💬 Chat feature coming soon!");
}

// Hide filters when the search box is emptied
document.getElementById("searchBox").addEventListener("input", function() {
  if (this.value === "") {
    document.getElementById("filterPanel").classList.remove("show");
    document.getElementById("filterCondition").value = "";
    document.getElementById("minPrice").value = "";
    document.getElementById("maxPrice").value = "";
    applyFilters();
  }
});

// Load saved listings when page opens
loadListings();

function filterCategory(category) {
  const listings = JSON.parse(localStorage.getItem("marketaListings")) || [];
  const matches = listings.filter(function(item) {
    return item.category === category;
  });
  renderListings(matches);   // ← we'll rename this line to the parent's real name
}

function filterCategory(category) {
  const listingsDiv = document.querySelector(".listings");
  const saved = JSON.parse(localStorage.getItem("marketaListings")) || [];

  listingsDiv.innerHTML = "";

  let count = 0;
  saved.forEach(function(item, index) {
    if (item.category === category) {
      const card = createCard(item, index);
      listingsDiv.prepend(card);
      count++;
    }
  });

  const banner = document.getElementById("filterBanner");
  banner.innerHTML =
    '<span>' + category + ' • ' + count + ' item' + (count === 1 ? '' : 's') + '</span>' +
    '<button class="clear-btn" onclick="clearCategoryFilter()">✕ Show All</button>';
  banner.style.display = "flex";

  listingsDiv.scrollIntoView({ behavior: "smooth" });
}

function clearCategoryFilter() {
  document.getElementById("filterBanner").style.display = "none";
  loadListings();
}
