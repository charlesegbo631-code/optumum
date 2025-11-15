document.addEventListener("DOMContentLoaded", () => {
  const countries = [
    { code: 'US', name: 'United States', flag: '🇺🇸' },
    { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
    { code: 'CA', name: 'Canada', flag: '🇨🇦' },
    { code: 'NG', name: 'Nigeria', flag: '🇳🇬' },
    { code: 'IN', name: 'India', flag: '🇮🇳' },
    { code: 'DE', name: 'Germany', flag: '🇩🇪' },
    { code: 'FR', name: 'France', flag: '🇫🇷' },
    { code: 'RU', name: 'Russia', flag: '🇷🇺' },
    { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
    { code: 'CN', name: 'China', flag: '🇨🇳' },
    { code: 'JP', name: 'Japan', flag: '🇯🇵' },
    { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
    { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  ];

  const grid = document.getElementById('countryGrid');
  countries.forEach(country => {
    const card = document.createElement('div');
    card.className = 'country-card';
    card.innerHTML = `
      <div class="country-flag">${country.flag}</div>
      <div>${country.name}</div>
    `;
    card.addEventListener("click", () => buyNumber(country));
    grid.appendChild(card);
  });

  async function buyNumber(country) {
    const token = localStorage.getItem('token');
    if (!token) {
      Swal.fire('Login required', 'Please log in first.', 'info');
      return;
    }

    const confirm = await Swal.fire({
      title: `Buy a real number from ${country.name}?`,
      text: "₦500 will be deducted from your wallet.",
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Buy Now'
    });

    if (confirm.isConfirmed) {
      try {
        const res = await fetch('/api/real-number', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({ country: country.code })
        });

        const data = await res.json();

        if (data.success) {
          Swal.fire('✅ Success!', `Your new number: ${data.number}`, 'success');
        } else {
          Swal.fire('❌ Error', data.error || 'Purchase failed', 'error');
        }
      } catch (err) {
        Swal.fire('❌ Network Error', 'Please try again later.', 'error');
      }
    }
  }
});
