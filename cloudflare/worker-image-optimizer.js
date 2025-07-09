// Cloudflare Worker for image optimization
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  
  // Extract image parameters from URL
  const width = url.searchParams.get('w')
  const height = url.searchParams.get('h')
  const quality = url.searchParams.get('q') || '85'
  const format = url.searchParams.get('f') || 'auto'
  
  // Build the original image URL
  const imageURL = url.origin + url.pathname.replace('/optimize', '')
  
  // Fetch the original image
  const imageRequest = new Request(imageURL, {
    headers: request.headers
  })
  
  // Use Cloudflare Image Resizing
  const options = {
    cf: {
      image: {
        fit: 'scale-down',
        width: width ? parseInt(width) : undefined,
        height: height ? parseInt(height) : undefined,
        quality: parseInt(quality),
        format: format
      },
      cacheEverything: true,
      cacheTtl: 86400 // 24 hours
    }
  }
  
  const response = await fetch(imageRequest, options)
  
  // Add cache headers
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('Vary', 'Accept')
  headers.set('X-Content-Type-Options', 'nosniff')
  
  // Add performance hints
  if (width && parseInt(width) <= 50) {
    headers.set('X-Robots-Tag', 'noindex')
  }
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  })
}

// Handle AVIF/WebP negotiation
function negotiateFormat(acceptHeader, requestedFormat) {
  if (requestedFormat !== 'auto') {
    return requestedFormat
  }
  
  if (acceptHeader.includes('image/avif')) {
    return 'avif'
  } else if (acceptHeader.includes('image/webp')) {
    return 'webp'
  }
  
  return 'jpeg'
}