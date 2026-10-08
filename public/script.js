document.addEventListener('DOMContentLoaded', () => {
    const publishBtn = document.getElementById('publishBtn');
    const postContent = document.getElementById('postContent');

    if (publishBtn) {
        publishBtn.addEventListener('click', async () => {
            const content = postContent.value.trim();
            if (!content) return alert('Please write something before publishing.');

            try {
                const response = await fetch('/api/posts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content })
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