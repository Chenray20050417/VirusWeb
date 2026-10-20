using UnityEngine;

public class EndlessMapManager : MonoBehaviour
{
    [System.Serializable]
    public class MapSegment
    {
        public Transform root;
        public Transform startPoint;
        public Transform endPoint;
    }

    [Header("玩家")]
    public Transform player;

    [Header("三段地圖")]
    public MapSegment[] segments;

    [Header("玩家超過該段 EndPoint 多遠後回收")]
    public float recycleDistance = 5f;

    private int currentOldestIndex = 0;

    void Update()
    {
        CheckRecycle();
    }

    void CheckRecycle()
    {
        MapSegment oldest = segments[currentOldestIndex];

        float playerZ = player.position.z;
        float endZ = oldest.endPoint.position.z;

        if (playerZ > endZ + recycleDistance)
        {
            MoveOldestSegmentToFront();

            currentOldestIndex++;

            if (currentOldestIndex >= segments.Length)
            {
                currentOldestIndex = 0;
            }
        }
    }

    void MoveOldestSegmentToFront()
    {
        MapSegment movingSegment =
            segments[currentOldestIndex];

        int newestIndex =
            currentOldestIndex - 1;

        if (newestIndex < 0)
        {
            newestIndex =
                segments.Length - 1;
        }

        MapSegment newestSegment =
            segments[newestIndex];

        AlignSegment(
            movingSegment,
            newestSegment.endPoint
        );
    }

    void AlignSegment(
        MapSegment movingSegment,
        Transform targetEndPoint
    )
    {
        // 先旋轉
        Quaternion rotationDifference =
            targetEndPoint.rotation *
            Quaternion.Inverse(
                movingSegment.startPoint.rotation
            );

        movingSegment.root.rotation =
            rotationDifference *
            movingSegment.root.rotation;


        // 再修正位置
        Vector3 positionDifference =
            targetEndPoint.position -
            movingSegment.startPoint.position;

        movingSegment.root.position +=
            positionDifference;
    }
}