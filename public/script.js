document.addEventListener('DOMContentLoaded', async () => {
    // 1. Fetch and display live stats on page load
    try {
        const statsResponse = await fetch('https://hoknex-backend.mr-motivationfamily.workers.dev/api/stats');
        if (statsResponse.ok) {
            const stats = await statsResponse.json();
            
            // Update the stats boxes on your homepage if the elements exist
            const globalStudentsEl = document.getElementById('globalStudents');
            const campusPostsEl = document.getElementById('campusPosts');
            const activeClubsEl = document.getElementById('activeClubs');

            if (globalStudentsEl) globalStudentsEl.textContent = stats.globalStudents;
            if (campusPostsEl) campusPostsEl.textContent = stats.campusPosts;
            if (activeClubsEl) activeClubsEl.textContent = stats.activeClubs;
        }
    } catch (err) {
        console.error('Stats error:', err);
    }

    // 2. Handle publishing posts
    const publishBtn = document.getElementById('publishBtn');
    const postContent = document.getElementById('postContent');

    if (publishBtn) {
        publishBtn.addEventListener('click', async () => {
            const content = postContent.value.trim();
            if (!content) return alert('Please write something before publishing.');

            try {
                const response = await fetch('https://hoknex-backend.mr-motivationfamily.workers.dev/api/posts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        title: 'Campus Update', 
                        content: content, 
                        author: 'Hoknex Student' 
                    })
                });

                if (response.ok) {
                    postContent.value = '';
                    alert('Published successfully to Hoknex!');
                } else {
                    alert('Failed to publish post.');
                }
            } catch (err) {
                console.error('Error posting:', err);
            }
        });
    }
});
