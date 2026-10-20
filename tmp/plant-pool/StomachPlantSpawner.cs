using UnityEngine;
using System.Collections.Generic;

#if UNITY_EDITOR
using UnityEditor;
#endif

public class StomachPlantSpawner : MonoBehaviour
{
    [Header("植物 Prefab")]
    public GameObject[] plantPrefabs;

    [Header("胃壁設定")]
    public Transform stomachWall;
    public Transform startPoint;
    public Transform endPoint;

    [Header("生成數量")]
    [Range(0, 200)]
    public int plantCount = 30;

    [Header("植物大小")]
    public float minScale = 0.4f;
    public float maxScale = 0.9f;

    [Header("射線設定")]
    public float rayDistance = 20f;
    public float wallOffset = 0.03f;

    [Header("沿路徑保留範圍")]
    [Range(0f, 1f)]
    public float startMargin = 0.08f;

    [Range(0f, 1f)]
    public float endMargin = 0.08f;

    [Header("其他設定")]
    public bool randomRotation = true;
    public bool clearBeforeGenerate = true;

    private sealed class PooledPlant
    {
        public GameObject instance;
        public GameObject prefab;
    }

    private readonly List<PooledPlant> pooledPlants = new List<PooledPlant>();
    private readonly Dictionary<GameObject, Stack<GameObject>> availablePlants =
        new Dictionary<GameObject, Stack<GameObject>>();
    private bool poolInitialized;

    void InitializePool()
    {
        if (poolInitialized) return;
        poolInitialized = true;
        // Adopt plants already generated and saved in the scene before Play.
        for (int i = 0; i < transform.childCount; i++)
        {
            GameObject child = transform.GetChild(i).gameObject;
            if (!child.name.EndsWith("_Generated")) continue;
            GameObject source = null;
#if UNITY_EDITOR
            source = PrefabUtility.GetCorrespondingObjectFromSource(child);
#endif
            if (source == null && plantPrefabs != null)
            {
                // In builds prefab links are unavailable; only accept an unambiguous name.
                foreach (GameObject prefab in plantPrefabs)
                {
                    if (prefab == null || child.name != prefab.name + "_Generated") continue;
                    if (source != null && source != prefab) { source = null; break; }
                    source = prefab;
                }
            }
            pooledPlants.Add(new PooledPlant { instance = child, prefab = source });
        }
    }

    GameObject AcquirePlant(GameObject prefab)
    {
        InitializePool();
        if (availablePlants.TryGetValue(prefab, out Stack<GameObject> available))
        {
            while (available.Count > 0)
            {
                GameObject existing = available.Pop();
                if (existing != null) return existing;
            }
        }

        // Grow only when this prefab's reusable supply is exhausted.
        GameObject created = Instantiate(prefab, transform);
        created.SetActive(false);
        pooledPlants.Add(new PooledPlant { instance = created, prefab = prefab });
        return created;
    }

    // Recycling replaces the previous layout even if manual generation is additive.
    public void RegeneratePlants()
    {
        bool originalClearSetting = clearBeforeGenerate;
        clearBeforeGenerate = true;
        try
        {
            GeneratePlants();
        }
        finally
        {
            clearBeforeGenerate = originalClearSetting;
        }
    }

    [ContextMenu("Generate Plants")]
    public void GeneratePlants()
    {
        if (stomachWall == null ||
            startPoint == null ||
            endPoint == null ||
            plantPrefabs == null ||
            plantPrefabs.Length == 0)
        {
            Debug.LogWarning("請先設定 stomachWall、startPoint、endPoint、plantPrefabs！");
            return;
        }

        if (clearBeforeGenerate)
            ClearPlants();

        MeshCollider[] wallColliders =
            stomachWall.GetComponentsInChildren<MeshCollider>(true);

        HashSet<Collider> allowedColliders = new HashSet<Collider>();

        foreach (MeshCollider col in wallColliders)
        {
            if (col.enabled && col.gameObject.activeInHierarchy)
                allowedColliders.Add(col);
        }

        if (allowedColliders.Count == 0)
        {
            Debug.LogWarning("stomachWall 底下找不到有效的 MeshCollider！");
            return;
        }

        Physics.SyncTransforms();

        Vector3 forward = (endPoint.position - startPoint.position).normalized;

        if (forward.sqrMagnitude < 0.001f)
        {
            Debug.LogWarning("StartPoint 和 EndPoint 太接近或重疊！");
            return;
        }

        // 建立與 forward 垂直的一組座標基底
        Vector3 right = Vector3.Cross(Vector3.up, forward).normalized;

        if (right.sqrMagnitude < 0.001f)
            right = Vector3.Cross(Vector3.forward, forward).normalized;

        Vector3 up = Vector3.Cross(forward, right).normalized;

        float minT = Mathf.Clamp01(startMargin);
        float maxT = 1f - Mathf.Clamp01(endMargin);

        if (minT >= maxT)
        {
            Debug.LogWarning("startMargin / endMargin 設定錯誤！");
            return;
        }

        int successCount = 0;
        int maxAttempts = Mathf.Max(plantCount * 20, 50);

        bool oldBackfaceSetting = Physics.queriesHitBackfaces;
        Physics.queriesHitBackfaces = true;

        try
        {
            for (int i = 0; i < maxAttempts && successCount < plantCount; i++)
            {
                float t = Random.Range(minT, maxT);

                Vector3 center = Vector3.Lerp(
                    startPoint.position,
                    endPoint.position,
                    t
                );

                // 360度隨機方向：上下左右整圈都可能生成
                float angle = Random.Range(0f, 360f) * Mathf.Deg2Rad;

                Vector3 direction =
                    (right * Mathf.Cos(angle) + up * Mathf.Sin(angle)).normalized;

                RaycastHit[] hits = Physics.RaycastAll(
                    center,
                    direction,
                    rayDistance,
                    ~0,
                    QueryTriggerInteraction.Ignore
                );

                float nearestDistance = float.MaxValue;
                RaycastHit bestHit = new RaycastHit();
                bool found = false;

                foreach (RaycastHit hit in hits)
                {
                    if (!allowedColliders.Contains(hit.collider))
                        continue;

                    if (hit.distance < nearestDistance)
                    {
                        nearestDistance = hit.distance;
                        bestHit = hit;
                        found = true;
                    }
                }

                if (!found)
                    continue;

                GameObject prefab =
                    plantPrefabs[Random.Range(0, plantPrefabs.Length)];

                if (prefab == null)
                    continue;

                Vector3 inwardNormal = bestHit.normal;

                // 讓植物朝向管道內部
                if (Vector3.Dot(inwardNormal, -direction) < 0f)
                    inwardNormal = -inwardNormal;

                Vector3 position = bestHit.point + inwardNormal * wallOffset;

                Quaternion rotation =
                    Quaternion.FromToRotation(Vector3.up, inwardNormal);

                if (randomRotation)
                {
                    rotation *= Quaternion.Euler(
                        0f,
                        Random.Range(0f, 360f),
                        0f
                    );
                }

                GameObject plant;

#if UNITY_EDITOR
                if (!Application.isPlaying)
                {
                    plant = PrefabUtility.InstantiatePrefab(
                        prefab,
                        gameObject.scene
                    ) as GameObject;
                }
                else
#endif
                {
                    plant = AcquirePlant(prefab);
                }

                if (plant == null)
                    continue;

                plant.transform.SetParent(transform, true);
                plant.transform.SetPositionAndRotation(position, rotation);

                float scale = Random.Range(minScale, maxScale);
                plant.transform.localScale = prefab.transform.localScale * scale;

                plant.name = prefab.name + "_Generated";
                if (Application.isPlaying) plant.SetActive(true);

#if UNITY_EDITOR
                if (!Application.isPlaying)
                    Undo.RegisterCreatedObjectUndo(plant, "Generate Plant");
#endif

                successCount++;
            }
        }
        finally
        {
            Physics.queriesHitBackfaces = oldBackfaceSetting;
        }

        Debug.Log("植物生成完成：" + successCount + "/" + plantCount);
    }

    [ContextMenu("Clear Plants")]
    public void ClearPlants()
    {
        if (Application.isPlaying)
        {
            InitializePool();
            foreach (Stack<GameObject> available in availablePlants.Values) available.Clear();
            foreach (PooledPlant plant in pooledPlants)
            {
                if (plant.instance == null) continue;
                plant.instance.SetActive(false);
                if (plant.prefab == null) continue;
                if (!availablePlants.TryGetValue(plant.prefab, out Stack<GameObject> available))
                {
                    available = new Stack<GameObject>();
                    availablePlants.Add(plant.prefab, available);
                }
                available.Push(plant.instance);
            }
            return;
        }

        for (int i = transform.childCount - 1; i >= 0; i--)
        {
            GameObject child = transform.GetChild(i).gameObject;

            if (!child.name.EndsWith("_Generated"))
                continue;

#if UNITY_EDITOR
            if (!Application.isPlaying)
                Undo.DestroyObjectImmediate(child);
            else
#endif
            {
                // Destroy is deferred until the end of the frame; hide old plants now.
                child.SetActive(false);
                Destroy(child);
            }
        }
    }
}
