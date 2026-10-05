import { useEffect, useState } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { LatLngBoundsExpression, LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';

type GeocodedPlace = {
  label: string;
  latitude: number;
  longitude: number;
  state: string | null;
  country: string | null;
};

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; state?: string; country?: string; city?: string };
};

const placeColors = ['#c76e4c', '#168b78', '#213a50'];

async function geocode(place: string, signal: AbortSignal): Promise<GeocodedPlace | null> {
  const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(place)}&limit=1`, { signal });
  if (!response.ok) return null;
  const data = await response.json() as { features?: PhotonFeature[] };
  const feature = data.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  if (!coordinates || coordinates.length < 2) return null;
  const properties = feature.properties;
  return {
    label: properties?.name || properties?.city || place,
    latitude: coordinates[1],
    longitude: coordinates[0],
    state: properties?.state || null,
    country: properties?.country || null,
  };
}

function FitRoute({ places }: { places: GeocodedPlace[] }) {
  const map = useMap();
  useEffect(() => {
    if (places.length === 1) map.setView([places[0]!.latitude, places[0]!.longitude], 8);
    if (places.length > 1) {
      const bounds: LatLngBoundsExpression = places.map(place => [place.latitude, place.longitude]);
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 8 });
    }
  }, [map, places]);
  return null;
}

export function TrackingMap({ origin, currentLocation, destination }: {
  origin: string;
  currentLocation: string | null | undefined;
  destination: string;
}) {
  const requestedPlaces = [
    { role: 'Origin', value: origin },
    ...(currentLocation ? [{ role: 'Current location', value: currentLocation }] : []),
    { role: 'Destination', value: destination },
  ];
  const [places, setPlaces] = useState<Array<{ role: string; place: GeocodedPlace }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setPlaces([]);
    setLoading(true);
    Promise.all(requestedPlaces.map(async item => {
      try {
        const place = await geocode(item.value, controller.signal);
        return place ? { role: item.role, place } : null;
      } catch {
        return null;
      }
    })).then(results => {
      if (!controller.signal.aborted) setPlaces(results.filter((result): result is { role: string; place: GeocodedPlace } => result !== null));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [origin, currentLocation, destination]);

  const points = places.map(item => [item.place.latitude, item.place.longitude] as LatLngExpression);
  const center: LatLngExpression = points[0] || [15, 0];

  return <section className="tracking-map-section" aria-label="Shipment route map">
    <div className="tracking-map-heading">
      <div><span className="eyebrow">Route map</span><h3>Location overview</h3></div>
      {loading && <span className="map-loading">Locating route...</span>}
    </div>
    {places.length > 0 ? <>
      <MapContainer className="tracking-map" center={center} zoom={4} scrollWheelZoom={false} aria-label="Map showing shipment origin, current location, and destination">
        <TileLayer attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'} url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {points.length > 1 && <Polyline positions={points} pathOptions={{ color: '#c76e4c', weight: 3, dashArray: '7 8' }} />}
        <FitRoute places={places.map(item => item.place)} />
        {places.map((item, index) => <CircleMarker key={`${item.role}-${item.place.latitude}-${item.place.longitude}`} center={[item.place.latitude, item.place.longitude]} radius={8} pathOptions={{ color: '#fffdf8', weight: 3, fillColor: placeColors[index] || placeColors[2], fillOpacity: 1 }}>
          <Tooltip direction="top" offset={[0, -8]}>{item.role}: {item.place.label}</Tooltip>
        </CircleMarker>)}
      </MapContainer>
      <div className="map-location-list">{requestedPlaces.map((requested, index) => {
        const match = places.find(item => item.role === requested.role);
        return <div className="map-location" key={requested.role}>
          <span className="map-location-dot" style={{ background: placeColors[index] || placeColors[2] }} />
          <div><strong>{requested.role}</strong><span>{match ? [match.place.state, match.place.country].filter(Boolean).join(', ') || match.place.label : 'Location details unavailable'}</span></div>
        </div>;
      })}</div>
    </> : <div className="map-unavailable">{loading ? 'Preparing the location map...' : 'Map coordinates are unavailable for these location names.'}</div>}
    <p className="map-attribution">Location results by <a href="https://photon.komoot.io/" target="_blank" rel="noreferrer">Photon</a> · Map tiles © OpenStreetMap contributors</p>
  </section>;
}
