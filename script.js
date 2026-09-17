// Remembers the chosen photos until posting is done (up to 3)
let currentPhotos = [];

// Remembers which listing the user tapped
let currentItemIndex = null;

// Which photo is currently shown in the detail carousel
let currentPhotoIndex = 0;

// When non-null, the sell modal is in "edit" mode for this listing index
let editingListingIndex = null;

// Escapes HTML characters in user text so it can't run as code
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Open/close the sell popup
function toggleSellPage() {
  const modal = document.getElementById("sellModal");
  const wasOpen = modal.classList.contains("show");

  modal.classList.toggle("show");

  // If we just CLOSED the modal, reset edit state and form
  if (wasOpen) {
    resetSellForm();
  }
}

// Clears the sell form and exits edit mode
function resetSellForm() {
  editingListingIndex = null;
  currentPhotos = [];
  document.getElementById("itemName").value = "";
  document.getElementById("itemPrice").value = "";
  document.getElementById("itemLocation").value = "";
  document.getElementById("itemDescription").value = "";
  document.getElementById("itemNegotiable").checked = false;
  document.getElementById("itemCategory").value = "";
  document.getElementById("itemCondition").value = "";
  document.getElementById("photoPreview").innerHTML = "📷";
  const counter = document.getElementById("photoCount");
  if (counter) counter.textContent = "";

  // Restore the default headings and button
  document.querySelector("#sellModal .modal-header h2").textContent = "Post Your Listing";
  document.querySelector("#sellModal .modal-body > button").textContent = "Post Listing";
}

// Shrink + preview the chosen photo. Adds to currentPhotos, max 3 total.
function previewPhoto() {
  if (currentPhotos.length >= 3) {
    alert("You can add up to 3 photos. Remove one first. 🙏");
    return;
  }

  const file = document.getElementById("itemPhoto").files[0];
  if (!file) return;

  if (file.size > 8 * 1024 * 1024) {
    alert("Photo is too large! Please choose one under 8MB. 🙏");
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 400 / img.width, 400 / img.height);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const compressed = canvas.toDataURL("image/jpeg", 0.7);
      currentPhotos.push(compressed);

      renderPhotoStrip();

      // Reset the input so the same file can be picked again if wanted
      document.getElementById("itemPhoto").value = "";
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// Draws thumbnails of the currently selected photos
function renderPhotoStrip() {
  const preview = document.getElementById("photoPreview");
  const counter = document.getElementById("photoCount");

  if (currentPhotos.length === 0) {
    preview.innerHTML = "📷";
    if (counter) counter.textContent = "";
    return;
  }

  let html = '<div class="photo-strip">';
  currentPhotos.forEach(function(p, i) {
    html += '<div class="photo-thumb">' +
      '<img src="' + p + '" alt="">' +
      '<button class="photo-remove" onclick="removePhoto(' + i + ')">✕</button>' +
      '</div>';
  });
  if (currentPhotos.length < 3) {
    html += '<div class="photo-add-more">Add</div>';
  }
  html += '</div>';
  preview.innerHTML = html;

  if (counter) counter.textContent = "· " + currentPhotos.length + " of 3";
}

// Remove a photo from the strip
function removePhoto(index) {
  currentPhotos.splice(index, 1);
  renderPhotoStrip();
}

// Show/hide the filters
function toggleFilters() {
  document.getElementById("filterPanel").classList.toggle("show");
}

function loadListings() {
  document.getElementById("filterBanner").style.display = "none";
  const listingsDiv = document.querySelector(".listings");
  listingsDiv.innerHTML = "";
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
  if (item.sold) {
    card.onclick = null;
    card.style.opacity = "0.6";
  }
  card.innerHTML =
    '<div class="thumb" style="height:180px;overflow:hidden;border-radius:12px 12px 0 0;">' + ((item.photos && item.photos.length > 0) || item.photo ? '<img src="' + ((item.photos && item.photos[0]) || item.photo) + '" style="width:100%;height:180px;object-fit:cover;display:block;">' : '📦') + '</div>' +
    '<h3>' + escapeHtml(item.name) + '</h3>' +
    '<p class="price">GH₵ ' + Number(item.price).toLocaleString() + (item.sold ? ' <span class="sold-badge">SOLD</span>' : '') + '</p>' +
    '<p class="location">📍 ' + escapeHtml(item.location) + ' • ' + escapeHtml(item.condition) + '</p>';
  return card;
}

// Show the detail popup for one listing
function showDetail(index) {
  const saved = JSON.parse(localStorage.getItem("marketaListings")) || [];
  const item = saved[index];

  if (!item) return;
  if (item.sold) return;

  currentItemIndex = index;

  // Figure out all the photos for this listing (new format + old format fallback)
  const photoList = (item.photos && item.photos.length > 0)
    ? item.photos
    : (item.photo ? [item.photo] : []);

  // Reset to first photo
  currentPhotoIndex = 0;

  const arrowLeft = document.getElementById("carouselLeft");
  const arrowRight = document.getElementById("carouselRight");
  const counter = document.getElementById("carouselCounter");

  if (photoList.length === 0) {
    document.getElementById("detailPhoto").innerHTML = "📦";
    arrowLeft.classList.remove("show");
    arrowRight.classList.remove("show");
    counter.classList.remove("show");
  } else if (photoList.length === 1) {
    document.getElementById("detailPhoto").innerHTML =
      `<img src="${photoList[0]}" alt="">`;
    arrowLeft.classList.remove("show");
    arrowRight.classList.remove("show");
    counter.classList.remove("show");
  } else {
    document.getElementById("detailPhoto").innerHTML =
      `<img src="${photoList[0]}" alt="">`;
    arrowLeft.classList.add("show");
    arrowRight.classList.add("show");
    counter.classList.add("show");
    counter.textContent = "1 / " + photoList.length;
  }

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

// Close all-categories modal by tapping the dark background
document.getElementById("allCategoriesModal").addEventListener("click", function(e) {
  if (e.target === this) {
    this.classList.remove("show");
  }
});

// Show the previous photo in the detail carousel
function prevPhoto() {
  const saved = JSON.parse(localStorage.getItem("marketaListings")) || [];
  const item = saved[currentItemIndex];
  if (!item) return;

  const photoList = (item.photos && item.photos.length > 0)
    ? item.photos
    : (item.photo ? [item.photo] : []);

  if (photoList.length < 2) return;

  currentPhotoIndex = (currentPhotoIndex - 1 + photoList.length) % photoList.length;
  updateCarousel(photoList);
}

// Show the next photo in the detail carousel
function nextPhoto() {
  const saved = JSON.parse(localStorage.getItem("marketaListings")) || [];
  const item = saved[currentItemIndex];
  if (!item) return;

  const photoList = (item.photos && item.photos.length > 0)
    ? item.photos
    : (item.photo ? [item.photo] : []);

  if (photoList.length < 2) return;

  currentPhotoIndex = (currentPhotoIndex + 1) % photoList.length;
  updateCarousel(photoList);
}

// Redraw the carousel photo and counter
function updateCarousel(photoList) {
  document.getElementById("detailPhoto").innerHTML =
    `<img src="${photoList[currentPhotoIndex]}" alt="">`;
  document.getElementById("carouselCounter").textContent =
    (currentPhotoIndex + 1) + " / " + photoList.length;
}

// Open the escrow checkout
function startEscrow() {
  const saved = JSON.parse(localStorage.getItem("marketaListings")) || [];
  const item = saved[currentItemIndex];

  if (!item) return;

  document.getElementById("escrowItemName").textContent = item.name;
  document.getElementById("escrowItemPrice").textContent = "Item price: GH₵ " + Number(item.price).toLocaleString();

  const total = Number(item.price);
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
  const refNumber = "MKT-" + String(Date.now()).slice(-6);

  const order = {
    ref: refNumber,
    itemId: item.id || null,
    itemName: item.name,
    itemPrice: Number(item.price),
    total: Number(item.price),
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
  orders.reverse();
  const listDiv = document.getElementById("ordersList");
  const noOrders = document.getElementById("noOrders");

  listDiv.innerHTML = "";

  const visible = orders.filter(function(order) {
    return !order.buyerDeleted;
  });

  if (visible.length === 0) {
    noOrders.style.display = "block";
  } else {
    noOrders.style.display = "none";

    orders.forEach(function(order, index) {
      if (order.buyerDeleted) return;

      const card = document.createElement("div");
      card.className = "order-card";

      const released = order.status === "Funds released to seller";
      const shipped = order.status === "Shipped — on the way";

      let badge = "";

      if (released) {
        badge = '<span class="status-badge status-released">✅ Funds released to seller</span>' +
          '<br><button class="ship-btn" style="background:#d9534f;" onclick="deleteOrder(\'' + order.ref + '\')">🗑 Delete</button>';
      } else if (order.status === "refunded") {
        badge = '<span class="status-badge status-held">🛡️ Refunded — seller was not paid</span>' +
          '<br><button class="ship-btn" style="background:#d9534f;" onclick="deleteOrder(\'' + order.ref + '\')">🗑 Delete</button>';
      } else if (order.status === "returnRequested") {
        badge = '<span class="status-badge status-held">⚠️ Return requested — ' + (order.returnReason || "Item doesn\'t match description") + '</span>' +
          '<br><span style="color:#b36b00;">📦 Ship the item back to the seller. Your money is still held safely in escrow.</span>' +
          '<br><button class="ship-btn" style="background:#676e22;margin-top:6px;" onclick="disputeOrder(\'' + order.ref + '\')">⚖️ Escalate to Admin</button>';
      } else if (order.status === "disputed") {
        badge = '<span class="status-badge status-held">⚖️ Dispute under review — ' + (order.returnReason || "") + '</span>' +
          '<br><button class="ship-btn" onclick="openThread(\'' + order.ref + '\')">⚖️ Evidence / Admin Chat</button>' +
          '<br><span style="color:#b36b00;">An admin is reviewing this dispute. Your funds remain safely held until a ruling is made.</span>';
      } else if (order.status === "awaitingShipment") {
        badge = '<span class="status-badge status-held">⏳ Payment received — waiting for seller to ship</span>';
      } else if (order.status === "Shipped — on the way") {
        badge = '<span class="status-badge status-shipped">📦 Shipped! — Confirm delivery when it arrives</span>' +
          '<br><button class="ship-btn" style="background:#28a745;" onclick="releaseFunds(\'' + order.ref + '\')">✅ Confirm Delivery — Release Payment</button>' +
          '<br><button class="ship-btn" style="background:#d9534f;" onclick="openReturn(\'' + order.ref + '\')">↩️ Request Return</button>';
      } else {
        badge = '<span class="status-badge status-held">🔒 Funds held safely in escrow. Waiting for seller to deliver item</span>';
      }

      card.innerHTML =
        '<div class="order-header" onclick="toggleOrder(\'d' + order.ref + '\')">' +
          '<b>' + order.ref + ' — ' + order.itemName + '</b>' +
          '<span class="chevron" id="chev-d' + order.ref + '">▸</span>' +
        '</div>' +
        '<div class="order-details" id="d' + order.ref + '">' +
          '<br>Total paid: GH¢ ' + order.total.toLocaleString() +
          '<br>Date: ' + order.date +
          '<br>' + badge +
        '</div>';

      listDiv.appendChild(card);
    });
  }

  document.getElementById("ordersModal").classList.add("show");
}

// Release escrow funds when buyer confirms delivery
function releaseFunds(ref) {
  if (!confirm("Did you receive the item in good condition? Payment will be released to the seller.")) {
    return;
  }

  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];
  orders.forEach(function(o) {
    if (o.ref === ref) {
      o.status = "Funds released to seller";
    }
  });
  localStorage.setItem("marketaOrders", JSON.stringify(orders));

  openOrders();
}

// Delete an order from My Orders (soft delete, ref-based)
function deleteOrder(ref) {
  if (!confirm("Delete this order permanently? This cannot be undone.")) {
    return;
  }

  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];

  orders.forEach(function(o) {
    if (o.ref === ref) {
      o.buyerDeleted = true;
      if (o.sellerDeleted) o.removeMe = true;
    }
  });

  for (let i = orders.length - 1; i >= 0; i--) {
    if (orders[i].removeMe) orders.splice(i, 1);
  }

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
  orders.reverse();
  const listDiv = document.getElementById("shopList");
  const noItems = document.getElementById("noShopItems");

  listDiv.innerHTML = "";

  if (saved.length === 0 && orders.length === 0) {
    noItems.style.display = "block";
  } else {
    noItems.style.display = "none";

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
        action = '<span class="status-badge status-released">✅ Delivered — Payment Released</span>' +
          '<br><button class="ship-btn" style="background:#d9534f;" onclick="deleteSellerOrder(\'' + order.ref + '\')">🗑 Remove</button>';
      } else if (shipped) {
        action = '<span class="status-badge status-shipped">🚚 Shipped — awaiting buyer confirmation</span>';
      } else if (order.status === "returnRequested") {
        action = '<span class="status-badge status-held">⚠️ RETURN REQUESTED — ' + (order.returnReason || "Item doesn\'t match description") + '</span>' +
          '<br><span style="color:#b36b00;">📦 The buyer is shipping the item back to you. When it arrives, refund them below. No payment will be released.</span>' +
          '<br><button class="ship-btn" style="background:#d9534f;" onclick="refundBuyer(\'' + order.ref + '\')">💸 Refund Buyer</button>' +
          '<br><button class="ship-btn" style="background:#676e22;margin-top:6px;" onclick="disputeOrder(\'' + order.ref + '\')">⚖️ Dispute — Ask Admin</button>';
      } else if (order.status === "refunded") {
        action = '<span class="status-badge status-held">📦 Order Refunded — no payment released</span>' +
          '<br><button class="ship-btn" style="background:#d9534f;" onclick="deleteSellerOrder(\'' + order.ref + '\')">🗑 Remove</button>';
      } else if (order.status === "disputed") {
        action = '<span class="status-badge status-held">⚖️ Buyer disputes this order — admin reviewing. Funds frozen.</span>' +
          '<br><button class="ship-btn" onclick="openThread(\'' + order.ref + '\', \'seller\')">⚖️ Evidence / Admin Chat</button>';
      } else {
        action = '<button class="ship-btn" onclick="markShipped(\'' + order.ref + '\')">🚚 Mark as Shipped</button>';
      }

      card.innerHTML =
        '<div class="order-header" onclick="toggleOrder(\'s' + order.ref + '\')">' +
          '<b>' + order.ref + ' — ' + order.itemName + '</b>' +
          '<span class="chevron" id="chev-s' + order.ref + '">▸</span>' +
        '</div>' +
        '<div class="order-details" id="s' + order.ref + '">' +
          '<br>💰 GH¢ ' + order.total.toLocaleString() + ' (held in escrow)' +
          '<br>📞 Buyer: ' + order.buyerPhone + ' • 📍 ' + order.buyerLocation +
          '<br>' + action +
        '</div>';

      listDiv.appendChild(card);
    });

    if (saved.length > 0) {
      const heading2 = document.createElement("h3");
      heading2.textContent = "🛍️ My Listings";
      listDiv.appendChild(heading2);
    }

    saved.forEach(function(item, index) {
      const card = document.createElement("div");
      card.className = "shop-card";

      const info = "• 📍 " + escapeHtml(item.location) + " • " + escapeHtml(item.condition);

      card.innerHTML = `
  <span class="shop-item-name">${escapeHtml(item.name)}</span>
  <br>
  <span class="shop-item-price">GH₵ ${Number(item.price).toLocaleString()}</span>
  ${info}
  <div class="shop-actions">
    <button class="ship-btn" style="background:#0d6efd;" onclick="startEditListing(${index})">✏️ Edit</button>
    <button class="ship-btn" onclick="toggleSold(${index})">Mark as Sold</button>
    <button class="ship-btn" style="background:#d9534f;" onclick="deleteListing(${index})">🗑️ Delete</button>
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
  openShop();
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

// Opens the sell modal in edit mode, pre-filled with the listing's values
function startEditListing(index) {
  const saved = JSON.parse(localStorage.getItem("marketaListings")) || [];
  const item = saved[index];
  if (!item) {
    alert("Listing not found. 🙏");
    return;
  }

  // Block editing if the listing has any active order
  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];
  const terminalStatuses = ["Funds released to seller", "refunded"];
  const hasActiveOrder = orders.some(function(o) {
    return o.itemId === item.id && !terminalStatuses.includes(o.status);
  });

  if (hasActiveOrder) {
    alert("🚫 This listing is in an active order and can't be edited. Finish or cancel the order first.");
    return;
  }

  // Enter edit mode
  editingListingIndex = index;

  // Pre-fill the form
  document.getElementById("itemName").value = item.name || "";
  document.getElementById("itemPrice").value = item.price || "";
  document.getElementById("itemLocation").value = item.location || "";
  document.getElementById("itemDescription").value = item.description || "";
  document.getElementById("itemNegotiable").checked = !!item.negotiable;
  document.getElementById("itemCategory").value = item.category || "";
  document.getElementById("itemCondition").value = item.condition || "";

  // Pre-load photos into the strip
  currentPhotos = (item.photos && item.photos.length > 0)
    ? item.photos.slice()
    : (item.photo ? [item.photo] : []);
  renderPhotoStrip();

  // Change the modal headings to "Edit" mode
  document.querySelector("#sellModal .modal-header h2").textContent = "Edit Listing";
  document.querySelector("#sellModal .modal-body > button").textContent = "Save Changes";

  // Close My Shop, open Sell modal
  closeShop();
  document.getElementById("sellModal").classList.add("show");
}

// Close My Shop
function closeShop() {
  document.getElementById("shopModal").classList.remove("show");
}

// Post a new listing OR save changes to an existing one
function postListing() {
  const item = {
    name: document.getElementById("itemName").value,
    price: document.getElementById("itemPrice").value,
    location: document.getElementById("itemLocation").value,
    category: document.getElementById("itemCategory").value,
    condition: document.getElementById("itemCondition").value,
    description: document.getElementById("itemDescription").value,
    negotiable: document.getElementById("itemNegotiable").checked,
    photos: currentPhotos
  };

  if (!item.name || !item.price || !item.location || !item.category || !item.condition) {
    alert("Please fill in all fields! 🙏");
    return;
  }

  const priceNum = Number(item.price);
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    alert("Please enter a valid price (a positive number). 🙏");
    return;
  }
  if (priceNum > 10000000) {
    alert("Price can't exceed GH₵ 10,000,000. 🙏");
    return;
  }

  const saved = JSON.parse(localStorage.getItem("marketaListings")) || [];

  // --- EDIT MODE ---
  if (editingListingIndex !== null) {
    const existing = saved[editingListingIndex];
    if (!existing) {
      alert("Something went wrong — listing not found. 🙏");
      resetSellForm();
      toggleSellPage();
      return;
    }

    saved[editingListingIndex] = {
      ...existing,
      name: item.name,
      price: item.price,
      location: item.location,
      category: item.category,
      condition: item.condition,
      description: item.description,
      negotiable: item.negotiable,
      photos: item.photos
    };

    try {
      localStorage.setItem("marketaListings", JSON.stringify(saved));
    } catch (err) {
      alert("❌ Storage is full! Try a smaller photo or delete old listings.");
      return;
    }

    resetSellForm();
    toggleSellPage();
    loadListings();
    alert("Listing updated! ✏️");
    return;
  }

  // --- CREATE MODE ---
  item.id = Date.now();
  saved.push(item);

  try {
    localStorage.setItem("marketaListings", JSON.stringify(saved));
  } catch (err) {
    alert("❌ Storage is full! Try a smaller photo or delete old listings.");
    return;
  }

  document.querySelector(".listings").prepend(createCard(item, saved.length - 1));

  resetSellForm();
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

// Open the "All Categories" modal
function openAllCategories() {
  document.getElementById("allCategoriesModal").classList.add("show");
}

// Close the "All Categories" modal
function closeAllCategories() {
  document.getElementById("allCategoriesModal").classList.remove("show");
}

// Filter by category, then close the modal
function pickCategory(category) {
  closeAllCategories();
  filterCategory(category);
}

// Load saved listings when page opens
loadListings();

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

var currentReturnIndex = null;

function openReturn(ref) {
  currentReturnRef = ref;
  document.getElementById("returnModal").style.display = "flex";
}

function closeReturn() {
  currentReturnRef = null;
  document.getElementById("returnModal").style.display = "none";
}

function submitReturn() {
  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];
  const reason = document.getElementById("returnReason").value;
  const note = document.getElementById("returnNote").value;

  orders.forEach(function(o) {
    if (o.ref === currentReturnRef) {
      o.status = "returnRequested";
      o.returnReason = reason;
      if (note) o.returnNote = note;
    }
  });

  localStorage.setItem("marketaOrders", JSON.stringify(orders));
  closeReturn();
  openOrders();
}

function refundBuyer(ref) {
  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];
  orders.forEach(function(order) {
    if (order.ref === ref) {
      order.status = "refunded";
    }
  });
  localStorage.setItem("marketaOrders", JSON.stringify(orders));
  openShop();
}

function disputeOrder(ref) {
  if (!confirm("Escalate this order to the Marketa admin? Held funds will be frozen until a ruling is made.")) return;
  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];
  orders.forEach(function(order) {
    if (order.ref === ref) {
      order.status = "disputed";
      order.disputedAt = new Date().toLocaleDateString();
    }
  });
  localStorage.setItem("marketaOrders", JSON.stringify(orders));
  openShop();
}

var logoTaps = 0;
var logoTapTimer = null;

function adminTap() {
  logoTaps++;
  if (logoTapTimer) clearTimeout(logoTapTimer);
  logoTapTimer = setTimeout(function() { logoTaps = 0; }, 2000);

  if (logoTaps >= 5) {
    logoTaps = 0;
    openAdmin();
  }
}

function openAdmin() {
  window.scrollTo(0, 0);
  document.querySelector("header").style.display = "none";
  document.querySelector("main").style.display = "none";
  document.getElementById("adminPanel").style.display = "block";

  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];
  orders.reverse();
  const disputes = orders.filter(function(order) {
    return order.status === "disputed";
  });

  const box = document.getElementById("adminDisputes");
  if (disputes.length === 0) {
    box.innerHTML = '<p>✅ No active disputes. All is calm.</p>';
    return;
  }

  box.innerHTML = disputes.map(function(order) {
    let threadHtml = '<div style="background:#fff3cd;border-radius:10px;padding:8px;margin:10px 0;max-height:300px;overflow-y:auto;">';
    (order.thread || []).forEach(function(m) {
      threadHtml += '<div style="background:' + (m.from === "admin" ? "#f0ad4e" : "#e9ecef") + ';border-radius:10px;padding:8px;margin:6px 0;">' +
        '<b>' + m.from + '</b> <small>' + m.time + '</small><br>' + m.text;
      if (m.img) {
        threadHtml += '<br><img src="' + m.img + '" style="max-width:100%;margin-top:6px;border-radius:8px;">';
      }
      threadHtml += '</div>';
    });
    if (!order.thread || order.thread.length === 0) {
      threadHtml += '<p style="margin:6px 0;">📭 No evidence submitted yet.</p>';
    }
    threadHtml += '</div>';

    return '<div class="order-card">' +
      '<b>' + order.ref + '</b> — ' + order.itemName + '<br>' +
      '💰 GH¢ ' + order.total + '<br>' +
      '⚠️ Reason: ' + (order.returnReason || "Not stated") + '<br>' +
      (order.returnNote ? '📝 Note: ' + order.returnNote + '<br>' : '') +
      '📅 Disputed: ' + (order.disputedAt || "") + '<br>' +
      threadHtml +
      '<input type="text" id="reply-' + order.ref + '" placeholder="Reply as admin..." style="width:100%;padding:10px;margin:8px 0;border:1px solid #ccc;border-radius:8px;box-sizing:border-box;">' +
      '<button class="ship-btn" onclick="adminReply(\'' + order.ref + '\')">📤 Send Reply</button>' +
      '<button class="ship-btn" style="background:#d9534f; display:block; margin:8px 0;" onclick="adminRuling(\'' + order.ref + '\',\'refund\')">💸 Rule: Refund Buyer</button>' +
      '<button class="ship-btn" style="background:#28a745; display:block;" onclick="adminRuling(\'' + order.ref + '\',\'release\')">✅ Rule: Release to Seller</button>' +
      '</div>';
  }).join("");
}

function closeAdmin() {
  document.getElementById("adminPanel").style.display = "none";
  document.querySelector("header").style.display = "";
  document.querySelector("main").style.display = "";
  window.scrollTo(0, 0);
}

function adminReply(ref) {
  const input = document.getElementById("reply-" + ref);
  const text = input.value.trim();
  if (!text) {
    alert("Type a reply first! 🙏");
    return;
  }
  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];
  const order = orders.find(function(o) { return o.ref === ref; });
  if (!order.thread) order.thread = [];
  order.thread.push({
    from: "admin",
    text: text,
    time: new Date().toLocaleString()
  });
  localStorage.setItem("marketaOrders", JSON.stringify(orders));
  openAdmin();
}

function adminRuling(ref, ruling) {
  if (!confirm("Are you sure? This ruling is final.")) return;
  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];
  orders.forEach(function(order) {
    if (order.ref === ref) {
      order.status = (ruling === "refund") ? "refunded" : "Funds released to seller";
      order.ruledBy = "admin";
      if (!order.thread) order.thread = [];
      order.thread.push({
        from: "admin",
        text: (ruling === "refund") ? "⚖️ FINAL RULING: Refund approved. The buyer will be refunded from escrow." : "⚖️ FINAL RULING: Funds released to the seller. Case closed.",
        time: new Date().toLocaleString()
      });
    }
  });
  localStorage.setItem("marketaOrders", JSON.stringify(orders));
  openAdmin();
}

function toggleOrder(id) {
  const el = document.getElementById(id);
  const chev = document.getElementById("chev-" + id);
  if (el.style.display === "block") {
    el.style.display = "none";
    chev.textContent = "▸";
  } else {
    el.style.display = "block";
    chev.textContent = "▾";
  }
}

function deleteSellerOrder(ref) {
  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];
  const idx = orders.findIndex(function(o) { return o.ref === ref; });
  if (idx !== -1) {
    orders.splice(idx, 1);
    localStorage.setItem("marketaOrders", JSON.stringify(orders));
    openShop();
  }
}

function toggleSold(index) {
  const saved = JSON.parse(localStorage.getItem("marketaListings")) || [];
  saved[index].sold = !saved[index].sold;
  localStorage.setItem("marketaListings", JSON.stringify(saved));
  openShop();
  loadListings();
}

let threadRef = null;
let threadRole = "buyer";

function openThread(ref, role) {
  threadRef = ref;
  threadRole = role || "buyer";
  renderThread();
  document.getElementById("threadModal").style.display = "flex";
}

function closeThread() {
  document.getElementById("threadModal").style.display = "none";
}

function renderThread() {
  const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];
  const order = orders.find(function(o) { return o.ref === threadRef; });
  const box = document.getElementById("threadMessages");
  box.innerHTML = "";
  (order.thread || []).forEach(function(m) {
    const bubble = document.createElement("div");
    bubble.style.cssText = "background:" + (m.from === "admin" ? "#f0ad4e" : "#e9ecef") + ";border-radius:10px;padding:8px;margin:6px 0;";
    bubble.innerHTML = "<b>" + m.from + "</b> <small>" + m.time + "</small><br>" + m.text;
    if (m.img) {
      const pic = document.createElement("img");
      pic.src = m.img;
      pic.style.cssText = "max-width:100%;margin-top:6px;border-radius:8px;";
      bubble.appendChild(pic);
    }
    box.appendChild(bubble);
  });
}

function sendThreadMessage() {
  const text = document.getElementById("threadInput").value.trim();
  const fileInput = document.getElementById("threadImage");
  const file = fileInput.files[0];

  function push(textFinal, imgFinal) {
    const orders = JSON.parse(localStorage.getItem("marketaOrders")) || [];
    const order = orders.find(function(o) { return o.ref === threadRef; });
    if (!order.thread) order.thread = [];
    order.thread.push({
      from: threadRole,
      text: textFinal,
      img: imgFinal,
      time: new Date().toLocaleString()
    });
    try {
      localStorage.setItem("marketaOrders", JSON.stringify(orders));
    } catch (err) {
      alert("❌ Message too large — try a smaller image.");
      return;
    }
    document.getElementById("threadInput").value = "";
    fileInput.value = "";
    renderThread();
  }

  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 600 / img.width, 600 / img.height);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        push(text, canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  } else {
    push(text, null);
  }
}