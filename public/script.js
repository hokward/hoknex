document.addEventListener('DOMContentLoaded', () => {
    // Fetch Live Database Stats from Render Backend
    async function fetchLiveStats() {
        try {
            const res = await fetch('https://hoknex-backend.onrender.com/api/stats');
            if (res.ok) {
                const data = await res.json();
                document.getElementById('globalStudents').innerText = data.globalStudents || data.people || 0;
                document.getElementById('campusPosts').innerText = data.campusPosts || data.posts || 0;
                document.getElementById('activeClubs').innerText = data.activeClubs || data.clubs || 0;
            }
        } catch (e) {
            console.error('Stats error:', e);
        }
    }
    fetchLiveStats();

    // Handle Login API via Render Backend
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const identifier = document.getElementById('loginIdentifier').value;
            const password = document.getElementById('loginPassword').value;

            try {
                const res = await fetch('https://hoknex-backend.onrender.com/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identifier, password })
                });
                const data = await res.json();
                if (res.ok) {
                    alert('Login successful!');
                    window.location.href = '/feed.html';
                } else {
                    alert(data.error || 'Login failed');
                }
            } catch (err) {
                console.error('Login error:', err);
            }
        });
    }
});
